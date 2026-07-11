import { describe, expect, test } from 'bun:test';
import {
  buildBody,
  buildQuery,
  castParamValue,
  flagNamesFor,
  formatResourceHelp,
  formatTopHelp,
  parseFlags,
  RESOURCES,
} from '../cli.ts';
import { ENDPOINTS } from '../registry.ts';
import { UsageError } from '../resolve.ts';

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
});
