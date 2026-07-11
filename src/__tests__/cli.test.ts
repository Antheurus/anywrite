import { describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildBody,
  buildQuery,
  castParamValue,
  dispatch,
  flagNamesFor,
  formatResourceHelp,
  formatTopHelp,
  parseFlags,
  RESOURCES,
} from '../cli.ts';
import type { FetchLike } from '../client.ts';
import { ENDPOINTS } from '../registry.ts';
import { UsageError } from '../resolve.ts';

/** dispatch() reads config via loadConfig() (env-first), and the wrapped `request()` falls back
 * to the global `fetch` when no fetchImpl is injected — so these two stubs are how dispatch's
 * request-shaping logic gets exercised without hitting the network or a real API key. */
function stubApiKeyEnv(): () => void {
  const original = process.env.ANYTYPE_API_KEY;
  process.env.ANYTYPE_API_KEY = 'test-key';
  return () => {
    if (original === undefined) {
      delete process.env.ANYTYPE_API_KEY;
    } else {
      process.env.ANYTYPE_API_KEY = original;
    }
  };
}

function stubFetch(handler: FetchLike): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe('parseFlags', () => {
  test('splits positionals from --flag value pairs', () => {
    const { positionals, flags } = parseFlags(['Antheurus', 'obj123', '--name', 'X']);
    expect(positionals).toEqual(['Antheurus', 'obj123']);
    expect(flags.get('name')).toEqual(['X']);
  });

  test('treats a flag with no following value as boolean presence', () => {
    const { flags } = parseFlags(['--all', '--pretty']);
    expect(flags.get('all')).toEqual(['true']);
    expect(flags.get('pretty')).toEqual(['true']);
  });

  test('a flag followed by another flag does not consume it as a value', () => {
    const { flags } = parseFlags(['--all', '--limit', '5']);
    expect(flags.get('all')).toEqual(['true']);
    expect(flags.get('limit')).toEqual(['5']);
  });

  test('repeatable flags accumulate multiple values', () => {
    const { flags } = parseFlags(['--filter', 'done=false', '--filter', 'tags[in]=a,b']);
    expect(flags.get('filter')).toEqual(['done=false', 'tags[in]=a,b']);
  });
});

describe('castParamValue', () => {
  test('casts number, splitting on invalid input', () => {
    expect(castParamValue('number', '42')).toBe(42);
    expect(() => castParamValue('number', 'nope')).toThrow(UsageError);
  });

  test('casts boolean: only the literal "false" is false', () => {
    expect(castParamValue('boolean', 'true')).toBe(true);
    expect(castParamValue('boolean', 'false')).toBe(false);
  });

  test('casts string[] by comma-splitting and trimming', () => {
    expect(castParamValue('string[]', 'a, b ,c')).toEqual(['a', 'b', 'c']);
  });
});

describe('flagNamesFor', () => {
  test('objects.type_key also accepts the --type alias', () => {
    expect(flagNamesFor('objects', 'type_key')).toEqual(['type_key', 'type']);
  });

  test('a param with no alias only has its own name', () => {
    expect(flagNamesFor('objects', 'name')).toEqual(['name']);
  });
});

describe('buildQuery', () => {
  const spec = ENDPOINTS.spaces?.list;
  if (!spec) {
    throw new Error('fixture missing: spaces.list');
  }

  test('reads declared queryParams from flags', () => {
    const { flags } = parseFlags(['--offset', '10', '--limit', '50']);
    expect(buildQuery(spec, flags)).toEqual({ offset: 10, limit: 50 });
  });

  test('--filter passes key[cond]=value straight into the query object', () => {
    const { flags } = parseFlags(['--filter', 'created_date[gte]=2024-01-01']);
    expect(buildQuery(spec, flags)['created_date[gte]']).toBe('2024-01-01');
  });

  test('a malformed --filter (no "=") is a UsageError', () => {
    const { flags } = parseFlags(['--filter', 'no-equals-sign']);
    expect(() => buildQuery(spec, flags)).toThrow(UsageError);
  });
});

describe('buildBody', () => {
  const createSpec = ENDPOINTS.objects?.create;
  if (!createSpec) {
    throw new Error('fixture missing: objects.create');
  }

  test('resolves the --type alias into the type_key bodyParam', () => {
    const { flags } = parseFlags(['--type', 'task', '--name', 'X']);
    expect(buildBody('objects', createSpec, flags)).toEqual({ type_key: 'task', name: 'X' });
  });

  test('throws UsageError when a required bodyParam is missing', () => {
    const { flags } = parseFlags(['--name', 'X']);
    expect(() => buildBody('objects', createSpec, flags)).toThrow(UsageError);
  });

  test('--json seeds the body and typed flags are layered on top', () => {
    const { flags } = parseFlags(['--json', '{"template_id":"tmpl1"}', '--type', 'task']);
    expect(buildBody('objects', createSpec, flags)).toEqual({
      template_id: 'tmpl1',
      type_key: 'task',
    });
  });

  test('rejects --json that is not a JSON object', () => {
    const { flags } = parseFlags(['--json', '[1,2,3]', '--type', 'task']);
    expect(() => buildBody('objects', createSpec, flags)).toThrow(UsageError);
  });
});

describe('help text is generated from the registry', () => {
  test('formatTopHelp lists every non-auth resource', () => {
    const help = formatTopHelp();
    for (const resource of RESOURCES) {
      expect(help).toContain(resource);
    }
    expect(RESOURCES).not.toContain('auth');
  });

  test('formatResourceHelp lists every action and its flags for a resource', () => {
    const help = formatResourceHelp('objects');
    for (const action of Object.keys(ENDPOINTS.objects ?? {})) {
      expect(help).toContain(action);
    }
    expect(help).toContain('--type_key');
    expect(help).toContain('--status');
  });

  test('formatResourceHelp throws UsageError for an unknown resource', () => {
    expect(() => formatResourceHelp('not-a-resource')).toThrow(UsageError);
  });

  test('objects create/update documents the --type alias alongside --type_key', () => {
    const help = formatResourceHelp('objects');
    expect(help).toContain('--type <type key|name>');
  });
});

describe('dispatch — request shaping (mocked fetch)', () => {
  test('binary quirk (files download) threads binary:true through to request', async () => {
    const restoreApiKey = stubApiKeyEnv();
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const restoreFetch = stubFetch(
      async () =>
        new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        }),
    );
    const outputPath = join(tmpdir(), `anywrite-cli-test-${Date.now()}.bin`);
    try {
      await dispatch('files', 'download', ['bafyspace', 'bafyfile', '--output', outputPath]);
      const written = await Bun.file(outputPath).arrayBuffer();
      expect(new Uint8Array(written)).toEqual(new Uint8Array(bytes));
    } finally {
      restoreFetch();
      restoreApiKey();
      await rm(outputPath, { force: true });
    }
  });

  test('POST endpoint with all-optional bodyParams and no flags sends {} as the body', async () => {
    const restoreApiKey = stubApiKeyEnv();
    let seenRequest: Request | undefined;
    const restoreFetch = stubFetch(async (input, init) => {
      seenRequest = new Request(input as string, init);
      return new Response(JSON.stringify({ data: [], pagination: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    try {
      await dispatch('search', 'global', ['--limit', '3']);
      expect(seenRequest?.method).toBe('POST');
      expect(await seenRequest?.text()).toBe('{}');
    } finally {
      restoreFetch();
      restoreApiKey();
    }
  });

  test('GET endpoint sends no body even when bodyParams would be empty', async () => {
    const restoreApiKey = stubApiKeyEnv();
    let seenRequest: Request | undefined;
    const restoreFetch = stubFetch(async (input, init) => {
      seenRequest = new Request(input as string, init);
      return new Response(JSON.stringify({ data: [], pagination: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    try {
      await dispatch('spaces', 'list', []);
      expect(seenRequest?.method).toBe('GET');
      expect(seenRequest?.body).toBeNull();
    } finally {
      restoreFetch();
      restoreApiKey();
    }
  });

  test('--all on a POST paginated endpoint (search.global) re-sends the built body on every page', async () => {
    const restoreApiKey = stubApiKeyEnv();
    const seenBodies: string[] = [];
    const restoreFetch = stubFetch(async (input, init) => {
      const req = new Request(input as string, init);
      seenBodies.push(await req.text());
      return new Response(JSON.stringify({ data: [], pagination: { has_more: false } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    try {
      await dispatch('search', 'global', ['--all', '--query', 'invoice']);
      expect(seenBodies.length).toBeGreaterThan(0);
      for (const body of seenBodies) {
        expect(body).toContain('"query":"invoice"');
      }
    } finally {
      restoreFetch();
      restoreApiKey();
    }
  });

  test('files upload with a nonexistent --file path is a clean UsageError, not an ENOENT', async () => {
    const restoreApiKey = stubApiKeyEnv();
    try {
      await expect(
        dispatch('files', 'upload', [
          'bafyspace',
          '--file',
          '/tmp/definitely-missing-anywrite-test.png',
        ]),
      ).rejects.toThrow(UsageError);
    } finally {
      restoreApiKey();
    }
  });
});
