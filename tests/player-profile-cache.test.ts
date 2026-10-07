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
}));
vi.mock('../lib/logger', () => ({
  default: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

let mapMetadata = new Map<string, { mapname: string; tier: number; wr_time: number | null; stages?: number }>();

const {
  getPlayerOverviewFromCache,
  getPlayerMapTimesFromCache,
  getIncompleteMapsFromCache,
  getLinearVsStagedPerTierFromCache,
} = await import('../lib/player-profile-cache');

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

  // The warmer refreshes through this function; re-recording would rescore all 100 entries each
  // pass, so the set never rotates and a profile nobody views is warmed forever.
  it('does not record the view when the warmer forces a refresh', async () => {
    await getPlayerOverviewFromCache(STEAM_ID, { force: true });

    expect(recordProfileView).not.toHaveBeenCalled();
  });

  // A 0-point player is absent from every ranked listing, so SQL returns a NULL rank, which
  // `Number(null) || 1` would report as rank 1.
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
  // Metadata excludes untiered maps and tiers outside 1-10; a miss is dropped, not faked as tier 1.
  it('drops maps that are absent from the metadata blob', async () => {
    mapMetadata = new Map([['surf_kitsune', { mapname: 'surf_kitsune', tier: 3, wr_time: 42 }]]);
    query.mockResolvedValue([[
      { mapname: 'surf_kitsune', runtimepro: 100, date: '', player_rank: 1 },
      { mapname: 'surf_untiered', runtimepro: 200, date: '', player_rank: 1 },
    ]]);

    const times = await getPlayerMapTimesFromCache(STEAM_ID);

    expect(times.map(t => t.mapname)).toEqual(['surf_kitsune']);
    expect(times[0].tier).toBe(3);
  });
});

describe('getIncompleteMapsFromCache', () => {
  // The universe is the metadata blob (what /maps lists), so a tiered map nobody has finished is
  // absent from both, not only from /maps.
  it('subtracts the player times from the metadata universe', async () => {
    mapMetadata = new Map([
      ['surf_kitsune', { mapname: 'surf_kitsune', tier: 3, wr_time: 42 }],
      ['surf_mesa', { mapname: 'surf_mesa', tier: 1, wr_time: null }],
    ]);
    query.mockResolvedValue([[{ mapname: 'surf_kitsune' }]]);

    const incomplete = await getIncompleteMapsFromCache(STEAM_ID);

    expect(incomplete.map(m => m.mapname)).toEqual(['surf_mesa']);
    expect(incomplete[0].wr_time).toBeNull();
  });
});

describe('getLinearVsStagedPerTierFromCache', () => {
  // Staged is isStagedMap over the metadata, the same check the map badges use.
  it('counts the player maps per tier, split by isStagedMap', async () => {
    mapMetadata = new Map([
      ['surf_a', { mapname: 'surf_a', tier: 2, wr_time: 1, stages: 0 }],
      ['surf_b', { mapname: 'surf_b', tier: 2, wr_time: 1, stages: 5 }],
      ['surf_c', { mapname: 'surf_c', tier: 1, wr_time: 1, stages: 0 }],
    ]);
    query.mockResolvedValue([[{ mapname: 'surf_b' }, { mapname: 'surf_a' }, { mapname: 'surf_c' }, { mapname: 'surf_untiered' }]]);

    expect(await getLinearVsStagedPerTierFromCache(STEAM_ID)).toEqual([
      { tier: 1, linear: 1, staged: 0 },
      { tier: 2, linear: 1, staged: 1 },
    ]);
  });
});
