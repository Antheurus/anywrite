import { describe, expect, test } from 'bun:test';
import type { FetchLike } from '../client.ts';
import { readPropertyValue, verifyObject, verifyObjects } from '../verify.ts';

const BASE_URL = 'http://localhost:31009';

function objectResponse(status: number, object: Record<string, unknown> | null): Response {
  return new Response(JSON.stringify(object === null ? {} : { object }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('readPropertyValue', () => {
  test('unwraps a select property to its tag name', () => {
    const properties = [{ key: 'status', select: { name: 'To Do' } }];
    expect(readPropertyValue(properties, 'status')).toBe('To Do');
  });

  test('joins a multi_select property into a comma-separated list', () => {
    const properties = [{ key: 'tag', multi_select: [{ name: 'a' }, { name: 'b' }] }];
    expect(readPropertyValue(properties, 'tag')).toBe('a,b');
  });

  test('reads a scalar field (text/number/checkbox/...) by its own name', () => {
    expect(readPropertyValue([{ key: 'notes', text: 'hello' }], 'notes')).toBe('hello');
    expect(readPropertyValue([{ key: 'priority', number: 3 }], 'priority')).toBe('3');
    expect(readPropertyValue([{ key: 'done', checkbox: true }], 'done')).toBe('true');
  });

  test('returns null when the key is not present', () => {
    expect(readPropertyValue([{ key: 'status', select: { name: 'Done' } }], 'missing')).toBeNull();
  });

  test('returns null when properties is not an array', () => {
    expect(readPropertyValue(undefined, 'status')).toBeNull();
    expect(readPropertyValue(null, 'status')).toBeNull();
  });
});

describe('verifyObject', () => {
  test('found + pass when the object exists and every expected property matches', async () => {
    const fetchImpl: FetchLike = async () =>
      objectResponse(200, {
        id: 'obj1',
        name: 'solusiagency: Fitur KPI Staff',
        properties: [{ key: 'status', select: { name: 'To Do' } }],
      });
    const config = { baseUrl: BASE_URL, apiKey: 'k', fetchImpl };

    const result = await verifyObject(config, 'space1', 'obj1', { status: 'To Do' });

    expect(result.found).toBe(true);
    expect(result.pass).toBe(true);
    expect(result.name).toBe('solusiagency: Fitur KPI Staff');
    expect(result.propertyChecks).toEqual([
      { key: 'status', expected: 'To Do', actual: 'To Do', pass: true },
    ]);
  });

  test('found but pass:false when a property does not match', async () => {
    const fetchImpl: FetchLike = async () =>
      objectResponse(200, {
        id: 'obj1',
        name: 'X',
        properties: [{ key: 'status', select: { name: 'In Progress' } }],
      });
    const config = { baseUrl: BASE_URL, apiKey: 'k', fetchImpl };

    const result = await verifyObject(config, 'space1', 'obj1', { status: 'To Do' });

    expect(result.found).toBe(true);
    expect(result.pass).toBe(false);
    expect(result.propertyChecks).toEqual([
      { key: 'status', expected: 'To Do', actual: 'In Progress', pass: false },
    ]);
  });

  test('no expectedProperties means pass:true as long as the object exists', async () => {
    const fetchImpl: FetchLike = async () => objectResponse(200, { id: 'obj1', name: 'X' });
    const config = { baseUrl: BASE_URL, apiKey: 'k', fetchImpl };

    const result = await verifyObject(config, 'space1', 'obj1', {});

    expect(result.found).toBe(true);
    expect(result.pass).toBe(true);
    expect(result.propertyChecks).toEqual([]);
  });

  test('found:false and pass:false on a 500 (unknown id returns 500, not 404 — see SKILL.md gotcha 10)', async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(JSON.stringify({ object: 'error', status: 500, message: 'boom' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    const config = { baseUrl: BASE_URL, apiKey: 'k', fetchImpl };

    const result = await verifyObject(config, 'space1', 'bad-id', { status: 'To Do' });

    expect(result.found).toBe(false);
    expect(result.pass).toBe(false);
    expect(result.error).toContain('boom');
    expect(result.propertyChecks).toEqual([]);
  });

  test('never throws — a fetch failure is captured as a result, not an exception', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('network unreachable');
    };
    const config = { baseUrl: BASE_URL, apiKey: 'k', fetchImpl };

    await expect(verifyObject(config, 'space1', 'obj1', {})).resolves.toMatchObject({
      found: false,
      pass: false,
      error: 'network unreachable',
    });
  });
});

describe('verifyObjects', () => {
  test('checks every id independently and preserves order, mixing pass/fail results', async () => {
    const responsesById: Record<string, Response> = {
      good: objectResponse(200, {
        id: 'good',
        name: 'Good',
        properties: [{ key: 'status', select: { name: 'To Do' } }],
      }),
      bad: new Response(JSON.stringify({ object: 'error', status: 500 }), { status: 500 }),
    };
    const fetchImpl: FetchLike = async (input) => {
      const url = String(input);
      const id = url.includes('/objects/good') ? 'good' : 'bad';
      return responsesById[id] as Response;
    };
    const config = { baseUrl: BASE_URL, apiKey: 'k', fetchImpl };

    const results = await verifyObjects(config, 'space1', ['good', 'bad'], { status: 'To Do' });

    expect(results.map((r) => r.id)).toEqual(['good', 'bad']);
    expect(results[0]).toMatchObject({ found: true, pass: true });
    expect(results[1]).toMatchObject({ found: false, pass: false });
  });

  test('empty objectIds returns an empty array without making any request', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('should not call fetch for an empty id list');
    };
    const config = { baseUrl: BASE_URL, apiKey: 'k', fetchImpl };

    await expect(verifyObjects(config, 'space1', [], { status: 'To Do' })).resolves.toEqual([]);
  });
});
