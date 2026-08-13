import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/valkey-cache', () => ({
  cacheGetWithTtl: () => Promise.resolve({ value: null, ttlMs: -2 }),
  cacheSet: vi.fn(),
  cacheGet: vi.fn(),
}));
vi.mock('../lib/valkey', () => ({
  default: {},
  waitForCacheReady: () => Promise.resolve(true),
}));
vi.mock('../lib/db', () => ({ default: { query: vi.fn() } }));
vi.mock('../lib/logger', () => ({
  default: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { sortCountries } = await import('../lib/country-cache');
type CountryRank = Parameters<typeof sortCountries>[0][number];

/** Ranks are by points, so DE and FR share rank 2 the way the loader assigns them. */
const RANKING = [
  { country: 'US', country_code: 'US', total_points: 300, player_count: 10, rank: 1 },
  { country: 'DE', country_code: 'DE', total_points: 200, player_count: 40, rank: 2 },
  { country: 'FR', country_code: 'FR', total_points: 200, player_count: 5, rank: 2 },
  { country: 'AU', country_code: 'AU', total_points: 100, player_count: 20, rank: 4 },
] as unknown as CountryRank[];

const codes = (rows: CountryRank[]) => rows.map((r) => r.country_code);

// PERF-6: these four sorts used to be four cache keys, each re-running the full
// `GROUP BY country` aggregation. They are pure functions of the one cached array.
describe('sortCountries', () => {
  it('sorts by points, players, country and rank', () => {
    expect(codes(sortCountries(RANKING, 'points', 'desc'))).toEqual(['US', 'DE', 'FR', 'AU']);
    expect(codes(sortCountries(RANKING, 'players', 'desc'))).toEqual(['DE', 'AU', 'US', 'FR']);
    expect(codes(sortCountries(RANKING, 'country', 'asc'))).toEqual(['AU', 'DE', 'FR', 'US']);
    expect(codes(sortCountries(RANKING, 'rank', 'asc'))).toEqual(['US', 'DE', 'FR', 'AU']);
  });

  it('reverses on the opposite order', () => {
    expect(codes(sortCountries(RANKING, 'players', 'asc'))).toEqual(['FR', 'US', 'AU', 'DE']);
    expect(codes(sortCountries(RANKING, 'country', 'desc'))).toEqual(['US', 'FR', 'DE', 'AU']);
  });

  // The array is the shared cached payload; mutating it would corrupt every
  // later reader of the same key within the process.
  it('does not mutate the cached array', () => {
    const before = codes(RANKING);
    sortCountries(RANKING, 'players', 'asc');

    expect(codes(RANKING)).toEqual(before);
  });

  // Ranks are assigned by points before caching, so a tie keeps its shared rank
  // rather than being renumbered per sort.
  it('keeps the points-derived rank when sorting by something else', () => {
    expect(sortCountries(RANKING, 'players', 'desc').map((r) => r.rank)).toEqual([2, 4, 1, 2]);
  });
});
