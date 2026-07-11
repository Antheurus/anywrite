import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

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

/** Writes ~/.anywrite/config.json, creating the directory if needed. Used by the auth flow (Phase 2). */
export function saveConfig(
  config: { apiKey: string; baseUrl?: string },
  paths: ConfigPaths = defaultConfigPaths(),
): void {
  mkdirSync(dirname(paths.anywriteConfigPath), { recursive: true });
  const payload: AnywriteConfigFile = {
    api_key: config.apiKey,
    base_url: config.baseUrl ?? DEFAULT_BASE_URL,
  };
  writeFileSync(paths.anywriteConfigPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}
