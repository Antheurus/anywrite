import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { ENDPOINTS, type EndpointSpec } from '../registry';

const SPEC_PATH = join(import.meta.dir, '..', '..', 'spec', 'openapi-2025-11-08.yaml');
const HTTP_METHODS = ['get', 'post', 'patch', 'delete', 'put'] as const;

interface OpenApiDocument {
  paths: Record<string, Partial<Record<(typeof HTTP_METHODS)[number], unknown>>>;
}

function loadSpecMethodPaths(): Set<string> {
  const doc = parse(readFileSync(SPEC_PATH, 'utf-8')) as OpenApiDocument;
  const methodPaths = new Set<string>();
  for (const [path, operations] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      if (operations[method]) {
        methodPaths.add(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return methodPaths;
}

function registryEntries(): EndpointSpec[] {
  return Object.values(ENDPOINTS).flatMap((resource) => Object.values(resource));
}

describe('registry vs vendored spec', () => {
  test('every (method, path) pair in the spec has exactly one registry entry', () => {
    const specMethodPaths = loadSpecMethodPaths();
    const registryMethodPaths = registryEntries().map((spec) => `${spec.method} ${spec.path}`);

    const missing = [...specMethodPaths].filter((mp) => !registryMethodPaths.includes(mp));
    const extra = registryMethodPaths.filter((mp) => !specMethodPaths.has(mp));

    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });

  test('registry has exactly 52 entries, no duplicate (method, path) pairs', () => {
    const entries = registryEntries();
    expect(entries).toHaveLength(52);

    const methodPaths = entries.map((spec) => `${spec.method} ${spec.path}`);
    expect(new Set(methodPaths).size).toBe(methodPaths.length);
  });
});

describe('quirk flags', () => {
  test('files.upload is multipart', () => {
    expect(ENDPOINTS.files?.upload?.quirks).toContain('multipart');
  });

  test('files.download is binary', () => {
    expect(ENDPOINTS.files?.download?.quirks).toContain('binary');
  });

  test('chat.stream is sse', () => {
    expect(ENDPOINTS.chat?.stream?.quirks).toContain('sse');
  });

  test('lists.add wraps the body in {"objects": [...]}', () => {
    expect(ENDPOINTS.lists?.add?.quirks).toContain('wrappedArray');
  });

  test('chat.messages paginates by cursor', () => {
    expect(ENDPOINTS.chat?.messages?.pagination).toBe('cursor');
  });

  test('objects.create sends body under bodyField "body"', () => {
    expect(ENDPOINTS.objects?.create?.bodyField).toBe('body');
  });

  test('objects.update sends body under bodyField "markdown"', () => {
    expect(ENDPOINTS.objects?.update?.bodyField).toBe('markdown');
  });
});
