/**
 * Name/key -> ID resolution against the live API. A value that already looks like an Anytype
 * CID (the 'bafy' prefix used by every space/type/property/object id) passes through
 * unresolved; everything else is matched by listing the resource and comparing name/key.
 */

import { type ClientConfig, type OffsetPage, paginateOffset, request } from './client.ts';

/** Thrown for anything the caller did wrong — unknown resource/action, missing flag, name that
 * doesn't resolve to anything. cli.ts prints `.message` to stderr and exits 2. */
export class UsageError extends Error {}

const ID_PREFIX = 'bafy';

export function looksLikeId(value: string): boolean {
  return value.startsWith(ID_PREFIX);
}

export interface NamedEntity {
  id?: string;
  name?: string;
  key?: string;
  format?: string;
}

async function listEntities(config: ClientConfig, path: string): Promise<NamedEntity[]> {
  return paginateOffset<NamedEntity>(async (offset) => {
    const result = await request(config, { method: 'GET', path, query: { offset, limit: 100 } });
    if (result.kind !== 'json') {
      throw new Error(`expected a JSON response from ${path}`);
    }
    return result.data as OffsetPage<NamedEntity>;
  });
}

function matchEntity(entities: NamedEntity[], nameOrKey: string): NamedEntity | undefined {
  const needle = nameOrKey.toLowerCase();
  return entities.find(
    (entity) => entity.name?.toLowerCase() === needle || entity.key?.toLowerCase() === needle,
  );
}

function requireId(entity: NamedEntity, kind: string, nameOrKey: string): string {
  if (!entity.id) {
    throw new UsageError(`${kind} "${nameOrKey}" has no id`);
  }
  return entity.id;
}

export async function findSpace(config: ClientConfig, name: string): Promise<NamedEntity> {
  const match = matchEntity(await listEntities(config, '/v1/spaces'), name);
  if (!match) {
    throw new UsageError(`space not found: "${name}"`);
  }
  return match;
}

export async function resolveSpaceId(config: ClientConfig, nameOrId: string): Promise<string> {
  if (looksLikeId(nameOrId)) {
    return nameOrId;
  }
  return requireId(await findSpace(config, nameOrId), 'space', nameOrId);
}

export async function findType(
  config: ClientConfig,
  spaceId: string,
  nameOrKey: string,
): Promise<NamedEntity> {
  const match = matchEntity(await listEntities(config, `/v1/spaces/${spaceId}/types`), nameOrKey);
  if (!match) {
    throw new UsageError(`type not found: "${nameOrKey}"`);
  }
  return match;
}

export async function resolveTypeId(
  config: ClientConfig,
  spaceId: string,
  nameOrKey: string,
): Promise<string> {
  if (looksLikeId(nameOrKey)) {
    return nameOrKey;
  }
  return requireId(await findType(config, spaceId, nameOrKey), 'type', nameOrKey);
}

export async function findProperty(
  config: ClientConfig,
  spaceId: string,
  nameOrKey: string,
): Promise<NamedEntity> {
  const match = matchEntity(
    await listEntities(config, `/v1/spaces/${spaceId}/properties`),
    nameOrKey,
  );
  if (!match) {
    throw new UsageError(`property not found: "${nameOrKey}"`);
  }
  return match;
}

export async function resolvePropertyId(
  config: ClientConfig,
  spaceId: string,
  nameOrKey: string,
): Promise<string> {
  if (looksLikeId(nameOrKey)) {
    return nameOrKey;
  }
  return requireId(await findProperty(config, spaceId, nameOrKey), 'property', nameOrKey);
}

/**
 * Tags accept a name, key, or id per the API (`select`/`multi_select` values resolve tag key OR
 * id server-side) — best-effort match by name/key/id here, falling back to the raw value
 * unresolved so a caller who already has the exact key/id keeps working even if this lookup
 * misses it.
 */
export async function resolveTagValue(
  config: ClientConfig,
  spaceId: string,
  propertyId: string,
  nameOrKeyOrId: string,
): Promise<string> {
  const tags = await listEntities(config, `/v1/spaces/${spaceId}/properties/${propertyId}/tags`);
  const needle = nameOrKeyOrId.toLowerCase();
  const match = tags.find(
    (tag) =>
      tag.name?.toLowerCase() === needle || tag.key === nameOrKeyOrId || tag.id === nameOrKeyOrId,
  );
  return match?.id ?? nameOrKeyOrId;
}

/** Fills a '{param}' path template. Shared by cli.ts (real request paths) and resolve.ts's own
 * list lookups above use plain template literals since they only ever have one variable. */
export function interpolatePath(template: string, values: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_match, paramName: string) => {
    const value = values[paramName];
    if (value === undefined) {
      throw new UsageError(`missing path parameter "${paramName}"`);
    }
    return encodeURIComponent(value);
  });
}
