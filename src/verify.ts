/**
 * Client-side verification for objects already created/updated via the API — re-fetches each id
 * and confirms it exists and (optionally) that given properties hold the expected values. This is
 * a composite of N GETs plus comparison logic, not a single Anytype endpoint, so it lives outside
 * the registry/dispatch machinery — same reasoning as auth.ts.
 */

import { type ClientConfig, request } from './client.ts';
import { isPlainObject } from './output.ts';

export interface PropertyCheck {
  key: string;
  expected: string;
  actual: string | null;
  pass: boolean;
}

export interface ObjectVerifyResult {
  id: string;
  name: string | null;
  found: boolean;
  error: string | null;
  propertyChecks: PropertyCheck[];
  pass: boolean;
}

/** Reads a property's rendered value off an object's `properties` array by key — select unwraps
 * to the tag name, multi_select joins tag names with a comma, every other format reads its own
 * named field (text/number/checkbox/url/email/phone/date). Returns null when the key is absent. */
export function readPropertyValue(properties: unknown, key: string): string | null {
  if (!Array.isArray(properties)) {
    return null;
  }
  const match = properties.find((entry) => isPlainObject(entry) && entry.key === key);
  if (!isPlainObject(match)) {
    return null;
  }
  if (isPlainObject(match.select)) {
    return typeof match.select.name === 'string' ? match.select.name : null;
  }
  if (Array.isArray(match.multi_select)) {
    return match.multi_select
      .map((tag) => (isPlainObject(tag) && typeof tag.name === 'string' ? tag.name : ''))
      .filter((name) => name.length > 0)
      .join(',');
  }
  for (const field of ['text', 'number', 'checkbox', 'url', 'email', 'phone', 'date'] as const) {
    if (field in match) {
      return String(match[field]);
    }
  }
  return null;
}

/** Re-fetches one object and checks it exists plus that every expectedProperties entry matches.
 * Never throws — a fetch failure (404/500/network) becomes `found: false` with `error` set, so a
 * batch of verifyObject calls can run to completion and report every id's outcome. */
export async function verifyObject(
  config: ClientConfig,
  spaceId: string,
  objectId: string,
  expectedProperties: Record<string, string>,
): Promise<ObjectVerifyResult> {
  try {
    const result = await request(config, {
      method: 'GET',
      path: `/v1/spaces/${spaceId}/objects/${objectId}`,
    });
    if (
      result.kind !== 'json' ||
      !isPlainObject(result.data) ||
      !isPlainObject(result.data.object)
    ) {
      throw new Error('expected a JSON object response with an "object" field');
    }
    const object = result.data.object;
    const name = typeof object.name === 'string' ? object.name : null;
    const propertyChecks: PropertyCheck[] = Object.entries(expectedProperties).map(
      ([key, expected]) => {
        const actual = readPropertyValue(object.properties, key);
        return { key, expected, actual, pass: actual === expected };
      },
    );
    return {
      id: objectId,
      name,
      found: true,
      error: null,
      propertyChecks,
      pass: propertyChecks.every((check) => check.pass),
    };
  } catch (err) {
    return {
      id: objectId,
      name: null,
      found: false,
      error: err instanceof Error ? err.message : String(err),
      propertyChecks: [],
      pass: false,
    };
  }
}

export async function verifyObjects(
  config: ClientConfig,
  spaceId: string,
  objectIds: string[],
  expectedProperties: Record<string, string>,
): Promise<ObjectVerifyResult[]> {
  const results: ObjectVerifyResult[] = [];
  for (const objectId of objectIds) {
    results.push(await verifyObject(config, spaceId, objectId, expectedProperties));
  }
  return results;
}
