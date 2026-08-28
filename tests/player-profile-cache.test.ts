import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordProfileView = vi.fn();
const query = vi.fn();

vi.mock('../lib/recent-profiles', () => ({ recordProfileView }));
vi.mock('../lib/valkey-cache', () => ({
  cacheGetWithTtl: () => Promise.resolve({ value: null, ttlMs: -2 }),
  cacheSet: vi.fn(),
  cacheGet: vi.fn(),
}));
vi.mock('../lib/valkey', () => ({
  default: {},
  waitForCacheReady: () => Promise.resolve(true),
}));
vi.mock('../lib/db', () => ({ default: { query: (...args: unknown[]) => query(...args) } }));
vi.mock('../lib/map-cache', () => ({
  getAllMapMetadataFromCache: () => Promise.resolve(mapMetadata),
  isStagedMap: () => false,
}));
vi.mock('../lib/logger', () => ({
  default: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

let mapMetadata = new Map<string, { tier: number; wr_time: number | null }>();

const { getPlayerOverviewFromCache, getPlayerMapTimesFromCache } = await import('../lib/player-profile-cache');

const STEAM_ID = 'STEAM_1:0:9471875';

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue([[{ steamid: STEAM_ID, name: 'a', country: 'US', points: 1, lastseen: '', rank: 1, maps: 1, bonuses: 0, stages: 0 }]]);
});

describe('getPlayerOverviewFromCache', () => {
  it('records the view, feeding the warm set', async () => {
    await getPlayerOverviewFromCache(STEAM_ID);

    expect(recordProfileView).toHaveBeenCalledWith(STEAM_ID);
  });

  // The warmer refreshes through this same function. Re-recording would give all
  // 100 entries a fresh score every pass, so the set could never rotate and a
  // profile nobody views any more would be warmed forever.
  it('does not record the view when the warmer forces a refresh', async () => {
    await getPlayerOverviewFromCache(STEAM_ID, { force: true });

    expect(recordProfileView).not.toHaveBeenCalled();
  });

  // A 0-point player is absent from every ranked listing, so SQL returns a NULL
  // rank; `Number(null) || 1` would have reported them as rank 1.
  it('keeps a null rank null', async () => {
    query.mockResolvedValue([[{ steamid: STEAM_ID, name: 'a', country: 'US', points: 0, lastseen: '', rank: null, maps: 0, bonuses: 0, stages: 0 }]]);

    const overview = await getPlayerOverviewFromCache(STEAM_ID);

    expect(overview?.player.rank).toBeNull();
  });

  it('does not record a player that does not exist', async () => {
    query.mockResolvedValueOnce([[]]);

    await getPlayerOverviewFromCache('99999999999999999');

    expect(recordProfileView).not.toHaveBeenCalled();
  });
});

describe('getPlayerMapTimesFromCache', () => {
  // Metadata excludes untiered maps and tiers outside 1-10; a miss used to be
  // rendered as a fabricated tier 1 instead of being dropped.
  it('drops maps that are absent from the metadata blob', async () => {
    mapMetadata = new Map([['surf_kitsune', { tier: 3, wr_time: 42 }]]);
    query.mockResolvedValue([[
      { mapname: 'surf_kitsune', runtimepro: 100, date: '', player_rank: 1 },
      { mapname: 'surf_untiered', runtimepro: 200, date: '', player_rank: 1 },
    ]]);

    const times = await getPlayerMapTimesFromCache(STEAM_ID);

    expect(times.map(t => t.mapname)).toEqual(['surf_kitsune']);
    expect(times[0].tier).toBe(3);
  });
});
