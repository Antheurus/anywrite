import { describe, expect, test } from 'bun:test';
import type { FetchLike } from '../client.ts';
import {
  findProperty,
  interpolatePath,
  looksLikeId,
  resolvePropertyId,
  resolveSpaceId,
  resolveTagValue,
  resolveTypeId,
  UsageError,
} from '../resolve.ts';

const BASE_URL = 'http://localhost:31009';

/** Serves a fixed list of entities for every request, regardless of path — enough for the
 * single-page (has_more: false) resolution paths exercised here. */
function fixtureFetch(entities: unknown[]): FetchLike {
  return async () =>
    new Response(JSON.stringify({ data: entities, pagination: { has_more: false } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
}

describe('looksLikeId', () => {
  test('treats a bafy-prefixed value as an id', () => {
    expect(looksLikeId('bafyreigxank2luzvggw7jsnkybpaoipjm3l3g2b3nt2jpm66liype3sd24')).toBe(true);
  });

  test('treats a plain name as not-an-id', () => {
    expect(looksLikeId('Antheurus')).toBe(false);
  });
});

describe('resolveSpaceId', () => {
  test('passes an id-shaped value through unresolved', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('should not call the API for an id passthrough');
    };
    const config = { baseUrl: BASE_URL, apiKey: 'k', fetchImpl };
    await expect(resolveSpaceId(config, 'bafyreigxank2')).resolves.toBe('bafyreigxank2');
  });

  test('resolves a space name case-insensitively', async () => {
    const config = {
      baseUrl: BASE_URL,
      apiKey: 'k',
      fetchImpl: fixtureFetch([{ id: 'bafyspace1', name: 'Antheurus' }]),
    };
    await expect(resolveSpaceId(config, 'antheurus')).resolves.toBe('bafyspace1');
  });

  test('throws UsageError when no space matches', async () => {
    const config = { baseUrl: BASE_URL, apiKey: 'k', fetchImpl: fixtureFetch([]) };
    await expect(resolveSpaceId(config, 'Nonexistent')).rejects.toBeInstanceOf(UsageError);
  });
});

describe('resolveTypeId / resolvePropertyId', () => {
  test('resolves a type by key', async () => {
    const config = {
      baseUrl: BASE_URL,
      apiKey: 'k',
      fetchImpl: fixtureFetch([{ id: 'bafytype1', name: 'Task', key: 'task' }]),
    };
    await expect(resolveTypeId(config, 'bafyspace1', 'task')).resolves.toBe('bafytype1');
  });

  test('resolves a property by name and findProperty returns the full entity', async () => {
    const config = {
      baseUrl: BASE_URL,
      apiKey: 'k',
      fetchImpl: fixtureFetch([
        { id: 'bafyprop1', name: 'Status', key: 'status', format: 'select' },
      ]),
    };
    await expect(resolvePropertyId(config, 'bafyspace1', 'Status')).resolves.toBe('bafyprop1');
    const property = await findProperty(config, 'bafyspace1', 'status');
    expect(property).toEqual({ id: 'bafyprop1', name: 'Status', key: 'status', format: 'select' });
  });
});

describe('resolveTagValue', () => {
  test('resolves a tag by name to its id', async () => {
    const config = {
      baseUrl: BASE_URL,
      apiKey: 'k',
      fetchImpl: fixtureFetch([{ id: 'bafytag1', name: 'To Do', key: 'todo-key' }]),
    };
    await expect(resolveTagValue(config, 'bafyspace1', 'bafyprop1', 'To Do')).resolves.toBe(
      'bafytag1',
    );
  });

  test('falls back to the raw value when no tag matches (already a key/id)', async () => {
    const config = { baseUrl: BASE_URL, apiKey: 'k', fetchImpl: fixtureFetch([]) };
    await expect(resolveTagValue(config, 'bafyspace1', 'bafyprop1', 'bafyrawtagid')).resolves.toBe(
      'bafyrawtagid',
    );
  });
});

describe('interpolatePath', () => {
  test('fills every path parameter', () => {
    expect(
      interpolatePath('/v1/spaces/{space_id}/objects/{object_id}', {
        space_id: 'bafyspace1',
        object_id: 'bafyobj1',
      }),
    ).toBe('/v1/spaces/bafyspace1/objects/bafyobj1');
  });

  test('URL-encodes each value', () => {
    expect(interpolatePath('/v1/spaces/{space_id}', { space_id: 'a b' })).toBe('/v1/spaces/a%20b');
  });

  test('throws UsageError when a value is missing', () => {
    expect(() => interpolatePath('/v1/spaces/{space_id}', {})).toThrow(UsageError);
  });
});
