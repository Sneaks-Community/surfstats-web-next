import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/logger', () => ({ default: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// getServerConfigs memoizes, so each case needs a fresh module.
async function configs(raw?: string) {
  vi.resetModules();
  if (raw === undefined) delete process.env.SERVERS_JSON;
  else process.env.SERVERS_JSON = raw;
  const { getServerConfigs } = await import('../lib/env');
  return getServerConfigs();
}

afterEach(() => {
  delete process.env.SERVERS_JSON;
});

// Entries reach GameDig.query() as host and port, so a malformed one must never get through.
describe('getServerConfigs', () => {
  it('parses a valid list and coerces a string port', async () => {
    expect(await configs('[{"name":"EU","ip":"1.2.3.4","port":27015}]')).toEqual([
      { name: 'EU', ip: '1.2.3.4', port: 27015 },
    ]);
    expect(await configs('[{"name":"EU","ip":"1.2.3.4","port":"27015"}]')).toEqual([
      { name: 'EU', ip: '1.2.3.4', port: 27015 },
    ]);
  });

  it('strips the surrounding single quotes shells and compose files leave in', async () => {
    expect(await configs(`'[{"name":"EU","ip":"1.2.3.4","port":27015}]'`)).toEqual([
      { name: 'EU', ip: '1.2.3.4', port: 27015 },
    ]);
  });

  it('returns an empty list when unset or empty', async () => {
    expect(await configs(undefined)).toEqual([]);
    expect(await configs('')).toEqual([]);
    expect(await configs('[]')).toEqual([]);
  });

  it('drops the whole list rather than pass a malformed entry to GameDig', async () => {
    for (const raw of [
      'not json',
      '{"name":"EU"}',
      '[{"name":"EU","ip":"1.2.3.4"}]',
      '[{"name":"","ip":"1.2.3.4","port":27015}]',
      '[{"name":"EU","ip":"1.2.3.4","port":70000}]',
      '[{"name":"EU","ip":"1.2.3.4","port":0}]',
      '[{"name":"EU","ip":"1.2.3.4","port":"abc"}]',
    ]) {
      expect(await configs(raw), raw).toEqual([]);
    }
  });
});

// NEXT_PUBLIC_SITE_URL is required: unset, the origin guard and every absolute
// link would fall back to the client-settable Host headers.
describe('validateEnv', () => {
  const REQUIRED = {
    MYSQL_HOST: 'db',
    MYSQL_USER: 'u',
    MYSQL_PASSWORD: 'p',
    MYSQL_DATABASE: 'cksurf',
    NEXT_PUBLIC_SITE_URL: 'https://stats.example.com',
  };

  const ORIGINAL_ENV = process.env;

  async function validate(overrides: Record<string, string | undefined> = {}) {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, ...REQUIRED, ...overrides };
    const { validateEnv } = await import('../lib/env');
    return validateEnv();
  }

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('passes with the required vars set', async () => {
    await expect(validate()).resolves.toBeUndefined();
  });

  it('throws when NEXT_PUBLIC_SITE_URL is missing or not an absolute URL', async () => {
    await expect(validate({ NEXT_PUBLIC_SITE_URL: undefined })).rejects.toThrow(
      /NEXT_PUBLIC_SITE_URL is required/
    );
    await expect(validate({ NEXT_PUBLIC_SITE_URL: 'stats.example.com' })).rejects.toThrow(
      /NEXT_PUBLIC_SITE_URL is required/
    );
  });

  // The cache is fail-closed, so a bad VALKEY_* value looks like a site outage
  // rather than a config error unless it's rejected here.
  it('rejects malformed VALKEY_* values', async () => {
    await expect(validate({ VALKEY_URL: 'localhost:6379' })).rejects.toThrow(/VALKEY_URL/);
    await expect(validate({ VALKEY_TLS: 'yes' })).rejects.toThrow(/VALKEY_TLS/);
    await expect(validate({ VALKEY_CONNECT_TIMEOUT: 'soon' })).rejects.toThrow(
      /VALKEY_CONNECT_TIMEOUT/
    );
    await expect(
      validate({ VALKEY_URL: 'rediss://cache:6379', VALKEY_TLS: 'true', VALKEY_CONNECT_TIMEOUT: '2000' })
    ).resolves.toBeUndefined();
  });
});

describe('getEnv', () => {
  const ORIGINAL_ENV = process.env;

  async function read(vars: Record<string, string>) {
    process.env = { NODE_ENV: 'test', ...vars };
    const { getEnv } = await import('../lib/env');
    return getEnv();
  }

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // Defaults live here, not in a per-module `parseInt(...) || n`.
  it('fills in the defaults and parses what is set', async () => {
    const env = await read({ RATE_LIMIT_MAX: '50', ALLOWED_ORIGINS: 'https://a.example, https://b.example' });

    expect(env.RATE_LIMIT_MAX).toBe(50);
    expect(env.RATE_LIMIT_PAGE_MAX).toBe(300);
    expect(env.DB_QUEUE_LIMIT).toBe(100);
    expect(env.VALKEY_TLS_REJECT_UNAUTHORIZED).toBe(true);
    expect(env.ALLOWED_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
  });

  // One typo must not quietly reset every other var to its default too.
  it('defaults only the invalid var', async () => {
    const env = await read({ RATE_LIMIT_MAX: 'lots', VALKEY_URL: 'redis://cache:6379' });

    expect(env.RATE_LIMIT_MAX).toBe(120);
    expect(env.VALKEY_URL).toBe('redis://cache:6379');
  });

  it('keeps the clamps the modules applied', async () => {
    const env = await read({ ANALYTICS_HEALTHCHECK_INTERVAL_MS: '500', PLAYERS_LIST_WARM_INTERVAL_MS: '1000' });

    expect(env.ANALYTICS_HEALTHCHECK_INTERVAL_MS).toBe(10_000);
    expect(env.PLAYERS_LIST_WARM_INTERVAL_MS).toBe(60_000);
    expect((await read({ ANALYTICS_HEALTHCHECK_INTERVAL_MS: '0' })).ANALYTICS_HEALTHCHECK_INTERVAL_MS).toBe(0);
  });
});
