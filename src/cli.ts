#!/usr/bin/env bun

import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  createApiKey,
  createChallenge,
  DEFAULT_BASE_URL,
  defaultConfigPaths,
  loadConfig,
  saveConfig,
} from './auth.ts';
import {
  AnywriteApiError,
  type ClientConfig,
  type OffsetPage,
  paginateCursor,
  paginateOffset,
  request,
} from './client.ts';
import { isPlainObject, printError, printJson, printPretty } from './output.ts';
import { ENDPOINTS, type EndpointSpec, type ParamSpec, type ParamType } from './registry.ts';
import {
  findProperty,
  interpolatePath,
  resolvePropertyId,
  resolveSpaceId,
  resolveTagValue,
  resolveTypeId,
  UsageError,
} from './resolve.ts';

type FlagMap = Map<string, string[]>;
type QueryValues = Record<string, string | number | boolean | undefined>;

export const RESOURCES = Object.keys(ENDPOINTS)
  .filter((resource) => resource !== 'auth')
  .sort();

// The registry keeps bodyParams flat (see registry.ts) — `--type` is a friendlier alias for the
// literal `type_key` bodyParam, not a second way to express something the registry can't.
const FLAG_ALIASES: Record<string, Record<string, string>> = {
  objects: { type: 'type_key' },
};

// -- argv parsing ------------------------------------------------------------------------------

export function parseFlags(tokens: string[]): { positionals: string[]; flags: FlagMap } {
  const positionals: string[] = [];
  const flags: FlagMap = new Map();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === undefined) {
      continue;
    }
    if (token.startsWith('--')) {
      const name = token.slice(2);
      const next = tokens[index + 1];
      let value = 'true';
      if (next !== undefined && !next.startsWith('--')) {
        value = next;
        index++;
      }
      const existing = flags.get(name);
      if (existing) {
        existing.push(value);
      } else {
        flags.set(name, [value]);
      }
    } else {
      positionals.push(token);
    }
  }
  return { positionals, flags };
}

function getFlag(flags: FlagMap, name: string): string | undefined {
  return flags.get(name)?.[0];
}

function getFlagValues(flags: FlagMap, name: string): string[] {
  return flags.get(name) ?? [];
}

function hasFlag(flags: FlagMap, name: string): boolean {
  return flags.has(name);
}

export function castParamValue(type: ParamType, raw: string): string | number | boolean | string[] {
  switch (type) {
    case 'string':
      return raw;
    case 'number': {
      const parsed = Number(raw);
      if (Number.isNaN(parsed)) {
        throw new UsageError(`expected a number, got "${raw}"`);
      }
      return parsed;
    }
    case 'boolean':
      return raw !== 'false';
    case 'string[]':
      return raw
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
  }
}

export function flagNamesFor(resource: string, paramName: string): string[] {
  const aliases = FLAG_ALIASES[resource] ?? {};
  const aliasNames = Object.entries(aliases)
    .filter(([, target]) => target === paramName)
    .map(([alias]) => alias);
  return [paramName, ...aliasNames];
}

function emit(value: unknown, flags: FlagMap): void {
  if (hasFlag(flags, 'pretty')) {
    printPretty(value);
  } else {
    printJson(value);
  }
}

// -- request shape construction -----------------------------------------------------------------

async function resolvePathParams(
  config: ClientConfig,
  spec: EndpointSpec,
  positionals: string[],
): Promise<Record<string, string>> {
  const values = [...positionals];
  if (spec.viewIdOptional && values.length === spec.pathParams.length - 1) {
    values.push('');
  }
  if (values.length < spec.pathParams.length) {
    const missing = spec.pathParams.slice(values.length);
    throw new UsageError(`missing positional argument(s): ${missing.join(' ')}`);
  }

  const result: Record<string, string> = {};
  let spaceId: string | undefined;
  for (const [index, paramName] of spec.pathParams.entries()) {
    const raw = values[index];
    if (raw === undefined) {
      throw new Error(`internal: missing resolved value for path parameter "${paramName}"`);
    }
    if (paramName === 'space_id') {
      spaceId = await resolveSpaceId(config, raw);
      result[paramName] = spaceId;
      continue;
    }
    if (paramName === 'type_id' || paramName === 'property_id') {
      if (spaceId === undefined) {
        throw new Error(`internal: "${paramName}" requires space_id to resolve first`);
      }
      result[paramName] =
        paramName === 'type_id'
          ? await resolveTypeId(config, spaceId, raw)
          : await resolvePropertyId(config, spaceId, raw);
      continue;
    }
    result[paramName] = raw;
  }
  return result;
}

export function buildQuery(spec: EndpointSpec, flags: FlagMap): QueryValues {
  const query: QueryValues = {};
  for (const param of spec.queryParams ?? []) {
    const raw = getFlag(flags, param.name);
    if (raw === undefined) {
      continue;
    }
    const value = castParamValue(param.type, raw);
    if (Array.isArray(value)) {
      throw new UsageError(`--${param.name} does not accept a list here`);
    }
    query[param.name] = value;
  }
  for (const raw of getFlagValues(flags, 'filter')) {
    const separatorIndex = raw.indexOf('=');
    if (separatorIndex === -1) {
      throw new UsageError(`--filter must be "key[cond]=value", got "${raw}"`);
    }
    query[raw.slice(0, separatorIndex)] = raw.slice(separatorIndex + 1);
  }
  return query;
}

export function buildBody(
  resource: string,
  spec: EndpointSpec,
  flags: FlagMap,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const jsonRaw = getFlag(flags, 'json');
  if (jsonRaw !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonRaw);
    } catch {
      throw new UsageError('--json value is not valid JSON');
    }
    if (!isPlainObject(parsed)) {
      throw new UsageError('--json value must be a JSON object');
    }
    Object.assign(body, parsed);
  }
  for (const param of spec.bodyParams ?? []) {
    const raw = flagNamesFor(resource, param.name)
      .map((name) => getFlag(flags, name))
      .find((value) => value !== undefined);
    if (raw !== undefined) {
      body[param.name] = castParamValue(param.type, raw);
    }
  }
  for (const required of spec.required ?? []) {
    if (!(required in body)) {
      throw new UsageError(`missing required flag for "${required}"`);
    }
  }
  return body;
}

/** Builds one PropertyLinkWithValue entry (spec's 11-shape oneOf) from a raw CLI string, using
 * the property's format to pick the right shaped field. Not modeled in registry.ts — see the
 * "KNOWN GAP" note in the phase brief this file implements. */
async function buildPropertyEntry(
  config: ClientConfig,
  spaceId: string,
  propertyKeyOrName: string,
  rawValue: string,
): Promise<Record<string, unknown>> {
  const property = await findProperty(config, spaceId, propertyKeyOrName);
  const key = property.key ?? property.id;
  if (key === undefined || property.id === undefined) {
    throw new UsageError(`property "${propertyKeyOrName}" is missing a key/id`);
  }
  const propertyId = property.id;
  const listValues = () =>
    rawValue
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

  switch (property.format) {
    case 'select':
      return { key, select: await resolveTagValue(config, spaceId, propertyId, rawValue) };
    case 'multi_select': {
      const ids = await Promise.all(
        listValues().map((value) => resolveTagValue(config, spaceId, propertyId, value)),
      );
      return { key, multi_select: ids };
    }
    case 'number':
      return { key, number: Number(rawValue) };
    case 'checkbox':
      return { key, checkbox: rawValue === 'true' };
    case 'files':
      return { key, files: listValues() };
    case 'objects':
      return { key, objects: listValues() };
    case 'url':
      return { key, url: rawValue };
    case 'email':
      return { key, email: rawValue };
    case 'phone':
      return { key, phone: rawValue };
    case 'date':
      return { key, date: rawValue };
    default:
      return { key, text: rawValue };
  }
}

/** Handles the three object-body shapes the flat registry can't express: `--status` (shortcut
 * for the "status" select property), `--property key=value` (repeatable, any property), and
 * `--icon` (omitted entirely when unset — an empty string 400s, per research.md). */
async function applyObjectPropertyFlags(
  config: ClientConfig,
  spaceId: string,
  flags: FlagMap,
  body: Record<string, unknown>,
): Promise<void> {
  const properties = Array.isArray(body.properties)
    ? [...(body.properties as Record<string, unknown>[])]
    : [];

  const statusValue = getFlag(flags, 'status');
  if (statusValue !== undefined) {
    properties.push(await buildPropertyEntry(config, spaceId, 'status', statusValue));
  }
  for (const raw of getFlagValues(flags, 'property')) {
    const separatorIndex = raw.indexOf('=');
    if (separatorIndex === -1) {
      throw new UsageError(`--property must be "key=value", got "${raw}"`);
    }
    const key = raw.slice(0, separatorIndex);
    const value = raw.slice(separatorIndex + 1);
    properties.push(await buildPropertyEntry(config, spaceId, key, value));
  }
  if (properties.length > 0) {
    body.properties = properties;
  }

  const iconValue = getFlag(flags, 'icon');
  if (iconValue !== undefined) {
    body.icon = { format: 'emoji', emoji: iconValue };
  }
}

// -- quirked response handling -------------------------------------------------------------------

async function runPaginated(
  config: ClientConfig,
  spec: EndpointSpec,
  path: string,
  query: QueryValues,
  flags: FlagMap,
): Promise<void> {
  if (spec.pagination === 'none') {
    throw new UsageError('this endpoint does not paginate — remove --all');
  }
  if (spec.pagination === 'offset') {
    const limit = typeof query.limit === 'number' ? query.limit : 100;
    const items = await paginateOffset<unknown>(async (offset) => {
      const result = await request(config, {
        method: spec.method,
        path,
        query: { ...query, offset, limit },
      });
      if (result.kind !== 'json') {
        throw new Error('expected a JSON response');
      }
      return result.data as OffsetPage<unknown>;
    }, limit);
    emit(items, flags);
    return;
  }

  const limit = typeof query.limit === 'number' ? query.limit : 50;
  const items = await paginateCursor<unknown>(
    async (afterOrderId) => {
      const result = await request(config, {
        method: spec.method,
        path,
        query: { ...query, after_order_id: afterOrderId, limit },
      });
      if (result.kind !== 'json') {
        throw new Error('expected a JSON response');
      }
      // Cursor pagination only applies to chat messages, which wraps items under "messages"
      // instead of the standard "data" envelope (ChatMessagesResponse, not PaginatedResponse).
      const data = result.data as { data?: unknown[]; messages?: unknown[] };
      return data.data ?? data.messages ?? [];
    },
    (item) => (isPlainObject(item) && typeof item.order_id === 'string' ? item.order_id : ''),
    limit,
  );
  emit(items, flags);
}

async function runStream(
  config: ClientConfig,
  spec: EndpointSpec,
  path: string,
  query: QueryValues,
  flags: FlagMap,
): Promise<void> {
  if (!hasFlag(flags, 'follow')) {
    throw new UsageError('this endpoint streams events — pass --follow to consume it');
  }
  const heartbeatRaw = getFlag(flags, 'heartbeat');
  const result = await request(config, {
    method: spec.method,
    path,
    query,
    sse: true,
    heartbeatSeconds: heartbeatRaw !== undefined ? Number(heartbeatRaw) : undefined,
  });
  if (result.kind !== 'stream') {
    throw new Error('expected an SSE stream response');
  }
  for await (const event of result.events) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  }
}

async function runBinaryDownload(
  config: ClientConfig,
  spec: EndpointSpec,
  path: string,
  query: QueryValues,
  flags: FlagMap,
): Promise<void> {
  const outputPath = getFlag(flags, 'output');
  if (outputPath === undefined) {
    throw new UsageError('this endpoint returns binary data — pass --output <path>');
  }
  const result = await request(config, { method: spec.method, path, query });
  if (result.kind !== 'binary') {
    throw new Error('expected a binary response');
  }
  await Bun.write(outputPath, result.data);
  process.stdout.write(
    `wrote ${result.data.byteLength} bytes to ${outputPath} (${
      result.contentType ?? 'unknown content-type'
    })\n`,
  );
}

async function runMultipartUpload(
  config: ClientConfig,
  spec: EndpointSpec,
  path: string,
  query: QueryValues,
  flags: FlagMap,
): Promise<void> {
  const filePath = getFlag(flags, 'file');
  if (filePath === undefined) {
    throw new UsageError('this endpoint uploads a file — pass --file <path>');
  }
  const result = await request(config, {
    method: spec.method,
    path,
    query,
    multipart: { fieldName: 'file', file: Bun.file(filePath), fileName: basename(filePath) },
  });
  if (result.kind === 'json') {
    emit(result.data, flags);
  }
}

// -- help text, generated from the registry --------------------------------------------------

const GLOBAL_FLAGS = [
  '--all              paginate the full result set (offset or cursor, per endpoint)',
  '--pretty           render tables / key-value lines instead of raw JSON',
  '--output <path>    write a binary response (files download) to this path',
  '--follow           consume an SSE stream (chat stream) and print one JSON line per event',
  '--json <raw>       merge a raw JSON object into the request body (escape hatch)',
  '--filter k[c]=v    raw query passthrough, repeatable (e.g. --filter "done=false")',
  '--file <path>      file to upload (files upload)',
  '--heartbeat <n>    Anytype-Heartbeat-Seconds for an SSE stream (1-60)',
];

export function formatTopHelp(): string {
  return [
    'anywrite <resource> <action> [flags]',
    '',
    'Resources:',
    ...RESOURCES.map((resource) => `  ${resource}`),
    '  auth               anywrite auth [--code <code>] [--status]',
    '',
    'Run `anywrite <resource> --help` to see actions and flags for a resource.',
    '',
    'Global flags:',
    ...GLOBAL_FLAGS.map((line) => `  ${line}`),
  ].join('\n');
}

function formatParamFlag(param: ParamSpec, required: boolean): string {
  return `  --${param.name} <${param.type}>${required ? ' (required)' : ''}`;
}

export function formatActionHelp(resource: string, action: string, spec: EndpointSpec): string {
  const requiredSet = new Set(spec.required ?? []);
  const lines = [`${resource} ${action}  ${spec.method} ${spec.path}`];
  if (spec.pathParams.length > 0) {
    lines.push(`  positionals: ${spec.pathParams.join(' ')}`);
  }
  for (const param of spec.queryParams ?? []) {
    lines.push(formatParamFlag(param, requiredSet.has(param.name)));
  }
  for (const param of spec.bodyParams ?? []) {
    lines.push(formatParamFlag(param, requiredSet.has(param.name)));
  }
  if (spec.quirks?.includes('multipart')) {
    lines.push('  --file <path> (required)');
  }
  if (spec.quirks?.includes('binary')) {
    lines.push('  --output <path> (required)');
  }
  if (spec.quirks?.includes('sse')) {
    lines.push('  --follow (required to consume the stream)');
  }
  if (spec.pagination !== 'none') {
    lines.push('  --all (paginate the full result set)');
  }
  if (resource === 'objects' && (action === 'create' || action === 'update')) {
    lines.push('  --status <tag name|key|id>   shortcut for the "status" select property');
    lines.push('  --property key=value         repeatable, sets any property by key/name');
    lines.push('  --icon <emoji>               sets an emoji icon; omitted entirely when unset');
  }
  return lines.join('\n');
}

export function formatResourceHelp(resource: string): string {
  const actions = ENDPOINTS[resource];
  if (!actions) {
    throw new UsageError(
      `unknown resource "${resource}". Resources: ${RESOURCES.join(', ')}, auth`,
    );
  }
  const lines = [`anywrite ${resource} <action> [flags]`, '', 'Actions:'];
  for (const [action, spec] of Object.entries(actions)) {
    lines.push('', formatActionHelp(resource, action, spec));
  }
  return lines.join('\n');
}

function formatAuthHelp(): string {
  return [
    'anywrite auth [--code <code>] [--status]',
    '',
    'Runs the challenge flow — a 4-digit code pops up in the Anytype desktop app.',
    '  --code <code>   the 4-digit code (skips the interactive stdin prompt)',
    '  --status        print whether a key is configured and which source it came from',
  ].join('\n');
}

// -- auth subcommand ----------------------------------------------------------------------------

function describeConfigSource(): { configured: boolean; source: string; baseUrl: string } {
  const paths = defaultConfigPaths();
  const config = loadConfig();
  if (process.env.ANYTYPE_API_KEY) {
    return { configured: true, source: 'env ANYTYPE_API_KEY', baseUrl: config.baseUrl };
  }
  if (existsSync(paths.anywriteConfigPath)) {
    return {
      configured: config.apiKey !== null,
      source: '~/.anywrite/config.json',
      baseUrl: config.baseUrl,
    };
  }
  if (existsSync(paths.anytypeCliConfigPath)) {
    return {
      configured: config.apiKey !== null,
      source: '~/.anytype-cli/config.yaml (fallback)',
      baseUrl: config.baseUrl,
    };
  }
  return { configured: false, source: 'none', baseUrl: DEFAULT_BASE_URL };
}

function printAuthStatus(): void {
  const status = describeConfigSource();
  process.stdout.write(`configured: ${status.configured ? 'yes' : 'no'}\n`);
  process.stdout.write(`source:     ${status.source}\n`);
  process.stdout.write(`base URL:   ${status.baseUrl}\n`);
}

async function promptForCode(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('Enter the 4-digit code from the Anytype desktop app: ');
    return answer.trim();
  } finally {
    rl.close();
  }
}

async function runAuthCommand(argv: string[]): Promise<void> {
  const { flags } = parseFlags(argv);
  if (hasFlag(flags, 'help')) {
    process.stdout.write(`${formatAuthHelp()}\n`);
    return;
  }
  if (hasFlag(flags, 'status')) {
    printAuthStatus();
    return;
  }

  const config = loadConfig();
  const challengeId = await createChallenge(config.baseUrl, 'anywrite');
  process.stdout.write(
    `Challenge created (${challengeId}). Check the Anytype desktop app for a 4-digit code.\n`,
  );
  const code = getFlag(flags, 'code') ?? (await promptForCode());
  const apiKey = await createApiKey(config.baseUrl, challengeId, code);
  saveConfig({ apiKey, baseUrl: config.baseUrl });
  process.stdout.write('Saved API key to ~/.anywrite/config.json\n');
}

// -- generic dispatch -----------------------------------------------------------------------

async function dispatch(resource: string, action: string, argv: string[]): Promise<void> {
  const actions = ENDPOINTS[resource];
  if (!actions) {
    throw new UsageError(
      `unknown resource "${resource}". Resources: ${RESOURCES.join(', ')}, auth`,
    );
  }
  if (action === '--help' || action === '-h') {
    process.stdout.write(`${formatResourceHelp(resource)}\n`);
    return;
  }
  const spec = actions[action];
  if (!spec) {
    throw new UsageError(
      `unknown action "${action}" for resource "${resource}". Actions: ${Object.keys(actions).join(', ')}`,
    );
  }

  const { positionals, flags } = parseFlags(argv);
  if (hasFlag(flags, 'help')) {
    process.stdout.write(`${formatActionHelp(resource, action, spec)}\n`);
    return;
  }

  const runtimeConfig = loadConfig();
  if (spec.auth !== false && runtimeConfig.apiKey === null) {
    throw new UsageError('not authenticated — run `anywrite auth` first');
  }
  const config: ClientConfig = { baseUrl: runtimeConfig.baseUrl, apiKey: runtimeConfig.apiKey };

  const pathParamValues = await resolvePathParams(config, spec, positionals);
  const path = interpolatePath(spec.path, pathParamValues);
  const query = buildQuery(spec, flags);
  const body = buildBody(resource, spec, flags);

  if (resource === 'objects' && (action === 'create' || action === 'update')) {
    const spaceId = pathParamValues.space_id;
    if (spaceId === undefined) {
      throw new Error('internal: objects create/update must resolve space_id');
    }
    await applyObjectPropertyFlags(config, spaceId, flags, body);
  }

  if (hasFlag(flags, 'all')) {
    await runPaginated(config, spec, path, query, flags);
    return;
  }
  if (spec.quirks?.includes('sse')) {
    await runStream(config, spec, path, query, flags);
    return;
  }
  if (spec.quirks?.includes('binary')) {
    await runBinaryDownload(config, spec, path, query, flags);
    return;
  }
  if (spec.quirks?.includes('multipart')) {
    await runMultipartUpload(config, spec, path, query, flags);
    return;
  }

  const result = await request(config, {
    method: spec.method,
    path,
    query,
    body: Object.keys(body).length > 0 ? body : undefined,
  });
  if (result.kind === 'json') {
    emit(result.data, flags);
  }
}

async function run(argv: string[]): Promise<void> {
  const [first, ...rest] = argv;
  if (first === undefined) {
    throw new UsageError(formatTopHelp());
  }
  if (first === '--help' || first === '-h') {
    process.stdout.write(`${formatTopHelp()}\n`);
    return;
  }
  if (first === 'auth') {
    await runAuthCommand(rest);
    return;
  }

  const resource = first;
  const [action, ...tail] = rest;
  if (action === undefined) {
    throw new UsageError(formatResourceHelp(resource));
  }
  await dispatch(resource, action, tail);
}

async function main(): Promise<void> {
  try {
    await run(process.argv.slice(2));
  } catch (err) {
    if (err instanceof AnywriteApiError) {
      printError(JSON.stringify(err.envelope, null, 2));
      if (err.kind === 'gone') {
        printError('(hint: this resource is already gone — a repeat delete returns 410)');
      } else if (err.kind === 'rate_limit') {
        printError('(hint: rate-limited — slow down repeated mutations)');
      }
      process.exitCode = 1;
      return;
    }
    if (err instanceof UsageError) {
      printError(err.message);
      process.exitCode = 2;
      return;
    }
    throw err;
  }
}

if (import.meta.main) {
  main();
}
