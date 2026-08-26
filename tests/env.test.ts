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

// These values reach GameDig.query() as a host and port, so a malformed entry
// must never get through.
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
