import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const setEx = vi.fn();
const mGet = vi.fn();

vi.mock('../lib/valkey', () => ({
  default: {
    get: (key: string) => get(key),
    setEx: (key: string, ttl: number, value: string) => setEx(key, ttl, value),
    mGet: (keys: string[]) => mGet(keys),
  },
}));
vi.mock('../lib/logger', () => ({
  default: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { default: logger } = await import('../lib/logger');

// The throttle state is module-level, so each case needs a fresh module.
async function load() {
  vi.resetModules();
  return import('../lib/valkey-cache');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// A connected-but-failing cache (OOM, READONLY after failover) sends every
// request to the DB uncached; without a log there is no signal at all.
describe('cache failure logging', () => {
  it('warns once per failure kind per minute and counts the rest', async () => {
    const { cacheGet } = await load();
    get.mockRejectedValue(new Error("OOM command not allowed when used memory > 'maxmemory'."));

    for (let i = 0; i < 5; i++) expect(await cacheGet('k')).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.warn).mock.calls[0][0]).toMatch(/\[Cache\] GET failed: OOM/);

    vi.advanceTimersByTime(60_000);
    await cacheGet('k');
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(vi.mocked(logger.warn).mock.calls[1][0]).toMatch(/\+4 more in the last 60s/);
  });

  it('does not let one kind suppress another', async () => {
    const { cacheGet, cacheSet } = await load();
    get.mockRejectedValue(new Error('READONLY You cannot write against a read only replica.'));
    setEx.mockRejectedValue(new Error("OOM command not allowed when used memory > 'maxmemory'."));

    await cacheGet('k');
    await cacheSet('k', { a: 1 }, 60);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('still resolves to a miss for every key when the cache is down', async () => {
    const { cacheGetMany } = await load();
    mGet.mockRejectedValue(new Error('SocketClosedUnexpectedlyError'));

    expect(await cacheGetMany(['a', 'b'])).toEqual([null, null]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
