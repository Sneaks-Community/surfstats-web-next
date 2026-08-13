import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mapKey,
  MAP_STATS_SUFFIXES,
  wrCheckpointSuffix,
  playersListKey,
  steamAvatarKey,
  SERVER_CACHE_KEY,
} from '../lib/cache-keys';

const cacheSet = vi.fn();
const query = vi.fn();

vi.mock('../lib/valkey-cache', () => ({
  cacheGetWithTtl: () => Promise.resolve({ value: null, ttlMs: -2 }),
  cacheSet: (key: string, value: unknown, ttl: number) => cacheSet(key, value, ttl),
  cacheGet: vi.fn(),
}));
vi.mock('../lib/valkey', () => ({
  default: { del: vi.fn() },
  waitForCacheReady: () => Promise.resolve(true),
}));
vi.mock('../lib/db', () => ({ default: { query: (...args: unknown[]) => query(...args) } }));
vi.mock('../lib/db-analytics', () => ({
  default: { query: (...args: unknown[]) => query(...args) },
  isAnalyticsAvailable: () => true,
}));
vi.mock('../lib/map-cache', () => ({
  getMapMetadataFromCache: () =>
    Promise.resolve({ checkpoints: 3, stages: 0, wr_holder_steamid: 'STEAM_1:0:1' }),
}));
vi.mock('../lib/logger', () => ({
  default: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const stats = await import('../lib/map-stats-cache');

const MAP = 'surf_test';

beforeEach(() => {
  vi.clearAllMocks();
  // One row shape that satisfies every fetcher's field reads.
  query.mockResolvedValue([[{ totalCount: 1, wrTime: 1, avgTime: 2 }]]);
});

describe('key builders', () => {
  it('builds the documented key shapes', () => {
    expect(mapKey(MAP, 'stats:completions')).toBe('surfstats:map:surf_test:stats:completions');
    expect(wrCheckpointSuffix(7)).toBe('stats:wr-checkpoint:7');
    expect(steamAvatarKey('STEAM_1:0:12345')).toBe('surfstats:steam:avatar:STEAM_1:0:12345');
    expect(SERVER_CACHE_KEY).toBe('surfstats:server:all');
  });

  // The warmer writes the default listing and the read path reads it; a key
  // mismatch is silent, the warmer just warms pages nobody reads.
  it('gives the default players listing the same key as an empty search', () => {
    expect(playersListKey(1, '')).toBe('surfstats:players:list:1:');
    expect(playersListKey(2, 'surf')).toBe('surfstats:players:list:2:surf');
  });
});

// MAP_STATS_SUFFIXES is the canonical list of the seven series the precache refreshes,
// so a fetcher writing a suffix that isn't in there is a series nothing enumerates.
describe('map stats suffixes', () => {
  it('cover every key the stats fetchers write', async () => {
    await Promise.all([
      stats.getCompletionsOverTimeFromCache(MAP),
      stats.getTimeOnMapDataFromCache(MAP),
      stats.getCheckpointStatsFromCache(MAP),
      stats.getWRCheckpointTimesFromCache(MAP, 3),
      stats.getFinishTimeDataFromCache(MAP),
      stats.getBonusCompletionsOverTimeFromCache(MAP),
      stats.getPercentileTimesFromCache(MAP),
    ]);

    const written = new Set(cacheSet.mock.calls.map((call) => String(call[0])));
    const declared = new Set(
      [...Object.values(MAP_STATS_SUFFIXES), wrCheckpointSuffix(3)].map(s => mapKey(MAP, s))
    );

    expect(written).toEqual(declared);
  });
});
