import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { type FetchLike, type RequestResult, request } from './client.ts';

export const DEFAULT_BASE_URL = 'http://localhost:31009';

export interface AnywriteConfig {
  apiKey: string | null;
  baseUrl: string;
}

export interface ConfigPaths {
  anywriteConfigPath: string;
  anytypeCliConfigPath: string;
}

interface AnywriteConfigFile {
  api_key?: string;
  base_url?: string;
  // Persistent app key for Anytype's internal middleware gRPC service, scoped to "Limited" —
  // separate from api_key (which is scoped to "JsonAPI" and can't call block-level RPCs like
  // BlockPaste). See src/grpc.ts and the `grpc-auth` CLI command.
  limited_app_key?: string;
}

/** Config file locations, resolved from a home directory so tests can inject a temp dir. */
export function defaultConfigPaths(homeDir: string = homedir()): ConfigPaths {
  return {
    anywriteConfigPath: join(homeDir, '.anywrite', 'config.json'),
    anytypeCliConfigPath: join(homeDir, '.anytype-cli', 'config.yaml'),
  };
}

function readAnywriteConfigFile(path: string): AnywriteConfigFile | null {
  if (!existsSync(path)) {
    return null;
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  return parsed as AnywriteConfigFile;
}

interface AnytypeCliConfig {
  appKey?: string;
  baseUrl?: string;
}

// ~/.anytype-cli/config.yaml is a flat two-key YAML file (app_key, base_url) — a real
// YAML parser is overkill for two scalar lines, so this is a trivial line-split parser.
function readAnytypeCliConfigFile(path: string): AnytypeCliConfig | null {
  if (!existsSync(path)) {
    return null;
  }
  const config: AnytypeCliConfig = {};
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    const separatorIndex = trimmed.indexOf(':');
    if (!trimmed || trimmed.startsWith('#') || separatorIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key === 'app_key') {
      config.appKey = value;
    } else if (key === 'base_url') {
      config.baseUrl = value;
    }
  }
  return config;
}

/**
 * Resolves the API key + base URL by precedence:
 * 1. env ANYTYPE_API_KEY (+ optional ANYTYPE_BASE_URL)
 * 2. ~/.anywrite/config.json
 * 3. ~/.anytype-cli/config.yaml (read-only fallback to the existing Go CLI's config)
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  paths: ConfigPaths = defaultConfigPaths(),
): AnywriteConfig {
  const envApiKey = env.ANYTYPE_API_KEY;
  if (envApiKey) {
    return { apiKey: envApiKey, baseUrl: env.ANYTYPE_BASE_URL ?? DEFAULT_BASE_URL };
  }

  const anywriteConfig = readAnywriteConfigFile(paths.anywriteConfigPath);
  if (anywriteConfig?.api_key) {
    return { apiKey: anywriteConfig.api_key, baseUrl: anywriteConfig.base_url ?? DEFAULT_BASE_URL };
  }

  const anytypeCliConfig = readAnytypeCliConfigFile(paths.anytypeCliConfigPath);
  if (anytypeCliConfig?.appKey) {
    return {
      apiKey: anytypeCliConfig.appKey,
      baseUrl: anytypeCliConfig.baseUrl ?? DEFAULT_BASE_URL,
    };
  }

  return { apiKey: null, baseUrl: DEFAULT_BASE_URL };
}

/** Writes ~/.anywrite/config.json, creating the directory if needed. Merges onto whatever is
 * already there so saving one key (e.g. limited_app_key) never clobbers another (e.g. api_key). */
function writeAnywriteConfigFile(
  patch: AnywriteConfigFile,
  paths: ConfigPaths = defaultConfigPaths(),
): void {
  mkdirSync(dirname(paths.anywriteConfigPath), { recursive: true });
  const existing = readAnywriteConfigFile(paths.anywriteConfigPath) ?? {};
  const payload: AnywriteConfigFile = { ...existing, ...patch };
  writeFileSync(paths.anywriteConfigPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

/** Used by the `auth` command's REST (JsonAPI-scope) challenge flow. */
export function saveConfig(
  config: { apiKey: string; baseUrl?: string },
  paths: ConfigPaths = defaultConfigPaths(),
): void {
  writeAnywriteConfigFile(
    { api_key: config.apiKey, base_url: config.baseUrl ?? DEFAULT_BASE_URL },
    paths,
  );
}

/** Used by the `grpc-auth` command's Limited-scope challenge flow (see src/grpc.ts). */
export function saveLimitedAppKey(
  limitedAppKey: string,
  paths: ConfigPaths = defaultConfigPaths(),
): void {
  writeAnywriteConfigFile({ limited_app_key: limitedAppKey }, paths);
}

/** Reads the persistent Limited-scope app key saved by `grpc-auth`, or null if not set. */
export function loadLimitedAppKey(paths: ConfigPaths = defaultConfigPaths()): string | null {
  const config = readAnywriteConfigFile(paths.anywriteConfigPath);
  return config?.limited_app_key ?? null;
}

function requireJsonField(result: RequestResult, field: string): unknown {
  if (result.kind !== 'json') {
    throw new Error(`auth request expected a JSON response, got ${result.kind}`);
  }
  const data = result.data as Record<string, unknown> | null;
  const value = data?.[field];
  if (typeof value !== 'string' || !value) {
    throw new Error(`auth response missing "${field}"`);
  }
  return value;
}

/**
 * Starts the auth challenge flow: the 4-digit code pops up in the Anytype desktop app.
 * Unauthenticated (no Bearer) but still sends Anytype-Version, per the spec.
 */
export async function createChallenge(
  baseUrl: string,
  appName: string,
  fetchImpl?: FetchLike,
): Promise<string> {
  const result = await request(
    { baseUrl, apiKey: null, fetchImpl },
    { method: 'POST', path: '/v1/auth/challenges', body: { app_name: appName } },
  );
  return requireJsonField(result, 'challenge_id') as string;
}

/** Exchanges a challenge id + the 4-digit code (from the desktop app) for a long-lived api_key. */
export async function createApiKey(
  baseUrl: string,
  challengeId: string,
  code: string,
  fetchImpl?: FetchLike,
): Promise<string> {
  const result = await request(
    { baseUrl, apiKey: null, fetchImpl },
    { method: 'POST', path: '/v1/auth/api_keys', body: { challenge_id: challengeId, code } },
  );
  return requireJsonField(result, 'api_key') as string;
}
