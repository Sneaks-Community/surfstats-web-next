import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheSet = vi.fn();
const query = vi.fn();

vi.mock('../lib/valkey-cache', () => ({
  cacheGetWithTtl: () => Promise.resolve({ value: null, ttlMs: -2 }),
  cacheSet: (key: string, value: unknown, ttl: number) => cacheSet(key, value, ttl),
  cacheGet: vi.fn(),
}));
vi.mock('../lib/valkey', () => ({
  default: {},
  waitForCacheReady: () => Promise.resolve(true),
}));
vi.mock('../lib/db', () => ({ default: { query: (...args: unknown[]) => query(...args) } }));
vi.mock('../lib/logger', () => ({
  default: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { getMapMetadataFromCache, findMapNameIgnoringCase } = await import('../lib/map-cache');

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue([[{ mapname: 'surf_test', tier: 3, completions: 1 }]]);
});

describe('getMapMetadataFromCache', () => {
  // Unsuffixed, a map called `metadata` would read back the full-blob key.
  it('namespaces the single-map key under the map', async () => {
    await getMapMetadataFromCache('surf_test');

    expect(cacheSet.mock.calls.map((call) => String(call[0]))).toContain(
      'surfstats:map:surf_test:metadata'
    );
  });

  it('rejects an invalid map name without reading the cache or the DB', async () => {
    expect(await getMapMetadataFromCache('../etc/passwd')).toBeNull();
    expect(cacheSet).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('findMapNameIgnoringCase', () => {
  it('returns the stored spelling, including mixed case, for a case-only mismatch', async () => {
    query.mockResolvedValue([[{ mapname: 'surf_beginner' }, { mapname: 'surf_kitsune2_GO' }]]);

    expect(await findMapNameIgnoringCase('SURF_BEGINNER')).toBe('surf_beginner');
    expect(await findMapNameIgnoringCase('surf_KITSUNE2_go')).toBe('surf_kitsune2_GO');
  });

  it('returns null for a name no map matches', async () => {
    expect(await findMapNameIgnoringCase('surf_nope')).toBeNull();
  });
});
