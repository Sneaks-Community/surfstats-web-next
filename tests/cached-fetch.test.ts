import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheGetWithTtl = vi.fn();
const cacheSet = vi.fn();
const waitForCacheReady = vi.fn();

vi.mock('../lib/valkey-cache', () => ({
  cacheGetWithTtl: (key: string) => cacheGetWithTtl(key),
  cacheSet: (key: string, value: unknown, ttl: number) => cacheSet(key, value, ttl),
  cacheGet: vi.fn(),
}));
vi.mock('../lib/valkey', () => ({ waitForCacheReady: () => waitForCacheReady() }));
vi.mock('../lib/logger', () => ({ default: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { cachedFetch, normalizeToCachedShape, CacheUnavailableError } = await import('../lib/cached-fetch');

const miss = { value: null, ttlMs: -1 };

beforeEach(() => {
  vi.clearAllMocks();
  waitForCacheReady.mockResolvedValue(true);
  cacheGetWithTtl.mockResolvedValue(miss);
  cacheSet.mockResolvedValue(undefined);
});

describe('cachedFetch', () => {
  it('caches a fetched value on a miss', async () => {
    const result = await cachedFetch('k', 60, () => Promise.resolve({ n: 1 }));

    expect(result).toEqual({ n: 1 });
    expect(cacheSet).toHaveBeenCalledWith('k', { n: 1 }, 60);
  });

  it('returns a hit without running the loader', async () => {
    cacheGetWithTtl.mockResolvedValue({ value: { n: 2 }, ttlMs: 60_000 });
    const loader = vi.fn();

    expect(await cachedFetch('k', 60, loader)).toEqual({ n: 2 });
    expect(loader).not.toHaveBeenCalled();
    expect(cacheSet).not.toHaveBeenCalled();
  });

  // REL-1: the whole point of onError. A transient DB failure must not pin an
  // empty result for the full TTL.
  it('never writes the onError fallback to the cache', async () => {
    const fallback = { players: [], total: 0 };

    const result = await cachedFetch(
      'k',
      3600,
      () => Promise.reject(new Error('DB down')),
      { onError: () => fallback }
    );

    expect(result).toBe(fallback);
    expect(cacheSet).not.toHaveBeenCalled();
  });

  it('propagates the error when no onError is given', async () => {
    await expect(cachedFetch('k', 60, () => Promise.reject(new Error('DB down')))).rejects.toThrow(
      'DB down'
    );
    expect(cacheSet).not.toHaveBeenCalled();
  });

  it('does not cache null or undefined results', async () => {
    expect(await cachedFetch('k', 60, () => Promise.resolve(null))).toBeNull();
    expect(await cachedFetch('k', 60, () => Promise.resolve(undefined))).toBeUndefined();
    expect(cacheSet).not.toHaveBeenCalled();
  });

  // REL-5: the readiness gate is awaited, and onError must not swallow it —
  // serving a fallback would hide a cache outage behind empty pages.
  it('throws CacheUnavailableError past onError when the cache is down', async () => {
    waitForCacheReady.mockResolvedValue(false);
    const loader = vi.fn();

    await expect(
      cachedFetch('k', 60, loader, { onError: () => ({ players: [] }) })
    ).rejects.toBeInstanceOf(CacheUnavailableError);
    expect(loader).not.toHaveBeenCalled();
  });

  // A background refresher must not DEL first: forcing skips the read and overwrites,
  // so there is no window where the key is missing and a visitor pays for the query.
  it('runs the loader and overwrites on a forced reload, hit or not', async () => {
    cacheGetWithTtl.mockResolvedValue({ value: { n: 1 }, ttlMs: 60_000 });
    const loader = vi.fn().mockResolvedValue({ n: 2 });

    expect(await cachedFetch('k', 60, loader, { lock: true, force: true })).toEqual({ n: 2 });
    expect(cacheGetWithTtl).not.toHaveBeenCalled();
    expect(cacheSet).toHaveBeenCalledWith('k', { n: 2 }, 60);
  });

  // One transient DB blip must not blank a page for the whole refresh interval.
  it('writes nothing when a forced reload fails, leaving the old value served', async () => {
    await expect(
      cachedFetch('k', 60, () => Promise.reject(new Error('DB down')), { force: true })
    ).rejects.toThrow('DB down');
    expect(cacheSet).not.toHaveBeenCalled();
  });

  // Refresh and miss share a lock key, so an entry expiring mid-refresh joins the
  // query in flight. ttlMs 0 makes the early-refresh roll certain.
  it('lets a miss join an in-flight background refresh instead of re-querying', async () => {
    let release: (value: { n: number }) => void = () => undefined;
    const loader = vi.fn(() => new Promise<{ n: number }>((resolve) => (release = resolve)));

    cacheGetWithTtl.mockResolvedValue({ value: { n: 1 }, ttlMs: 0 });
    expect(await cachedFetch('k', 60, loader, { lock: true })).toEqual({ n: 1 });
    expect(loader).toHaveBeenCalledTimes(1);

    cacheGetWithTtl.mockResolvedValue(miss);
    const joined = cachedFetch('k', 60, loader, { lock: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    release({ n: 2 });

    expect(await joined).toEqual({ n: 2 });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cacheSet).toHaveBeenCalledTimes(1);
  });

  // COR-9: the miss path must hand back the same shape the hit path does.
  it('normalizes the fetched value to its cached shape', async () => {
    const date = new Date('2026-02-24T19:15:18.000Z');

    const result = await cachedFetch<{ date: string }>('k', 60, () =>
      Promise.resolve({ date } as unknown as { date: string })
    );

    expect(result.date).toBe('2026-02-24T19:15:18.000Z');
    expect(cacheSet).toHaveBeenCalledWith('k', { date: '2026-02-24T19:15:18.000Z' }, 60);
  });
});

describe('normalizeToCachedShape', () => {
  it('converts Date values to the ISO strings the cache round trip produces', () => {
    const row = { date: new Date('2026-02-24T19:15:18.000Z'), name: 'a', rank: 1 };

    expect(normalizeToCachedShape(row)).toEqual({
      date: '2026-02-24T19:15:18.000Z',
      name: 'a',
      rank: 1,
    });
  });

  it('passes null and undefined through untouched', () => {
    expect(normalizeToCachedShape(null)).toBeNull();
    expect(normalizeToCachedShape(undefined)).toBeUndefined();
  });
});
