import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ConfigPaths, DEFAULT_BASE_URL, loadConfig, saveConfig } from '../auth';

let tempDir: string;
let paths: ConfigPaths;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'anywrite-auth-test-'));
  paths = {
    anywriteConfigPath: join(tempDir, '.anywrite', 'config.json'),
    anytypeCliConfigPath: join(tempDir, '.anytype-cli', 'config.yaml'),
  };
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  test('falls back to defaults when no source is configured', () => {
    const config = loadConfig({}, paths);
    expect(config).toEqual({ apiKey: null, baseUrl: DEFAULT_BASE_URL });
  });

  test('reads app_key + base_url from the anytype-cli YAML fallback', () => {
    mkdirSync(join(tempDir, '.anytype-cli'), { recursive: true });
    writeFileSync(
      paths.anytypeCliConfigPath,
      'app_key: fixture-cli-key\nbase_url: http://localhost:31010\n',
      'utf-8',
    );

    const config = loadConfig({}, paths);
    expect(config).toEqual({ apiKey: 'fixture-cli-key', baseUrl: 'http://localhost:31010' });
  });

  test('anywrite config.json takes precedence over the anytype-cli fallback', () => {
    mkdirSync(join(tempDir, '.anytype-cli'), { recursive: true });
    writeFileSync(paths.anytypeCliConfigPath, 'app_key: fixture-cli-key\n', 'utf-8');

    mkdirSync(join(tempDir, '.anywrite'), { recursive: true });
    writeFileSync(
      paths.anywriteConfigPath,
      JSON.stringify({ api_key: 'fixture-anywrite-key' }),
      'utf-8',
    );

    const config = loadConfig({}, paths);
    expect(config).toEqual({ apiKey: 'fixture-anywrite-key', baseUrl: DEFAULT_BASE_URL });
  });

  test('env ANYTYPE_API_KEY takes precedence over every file source', () => {
    mkdirSync(join(tempDir, '.anytype-cli'), { recursive: true });
    writeFileSync(paths.anytypeCliConfigPath, 'app_key: fixture-cli-key\n', 'utf-8');

    mkdirSync(join(tempDir, '.anywrite'), { recursive: true });
    writeFileSync(
      paths.anywriteConfigPath,
      JSON.stringify({ api_key: 'fixture-anywrite-key' }),
      'utf-8',
    );

    const config = loadConfig(
      { ANYTYPE_API_KEY: 'fixture-env-key', ANYTYPE_BASE_URL: 'http://localhost:9999' },
      paths,
    );
    expect(config).toEqual({ apiKey: 'fixture-env-key', baseUrl: 'http://localhost:9999' });
  });
});

describe('saveConfig', () => {
  test('writes ~/.anywrite/config.json and creates the directory', () => {
    saveConfig({ apiKey: 'fixture-saved-key', baseUrl: 'http://localhost:31011' }, paths);

    const config = loadConfig({}, paths);
    expect(config).toEqual({ apiKey: 'fixture-saved-key', baseUrl: 'http://localhost:31011' });
  });
});
