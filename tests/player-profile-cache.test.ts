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
vi.mock('../lib/logger', () => ({
  default: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { getPlayerOverviewFromCache } = await import('../lib/player-profile-cache');

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
