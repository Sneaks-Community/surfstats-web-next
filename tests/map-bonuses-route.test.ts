import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getBonusRecordsFromCache = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('../lib/map-records-cache', () => ({
  getBonusRecordsFromCache: (...args: unknown[]) => getBonusRecordsFromCache(...args),
  searchBonusRecordsFromCache: vi.fn(),
  getRecordCountsAndWRFromCache: () => Promise.resolve({ counts: { bonusesTotal: 250 }, wr_time: null }),
}));
vi.mock('../lib/registry-cache', () => ({
  getBonusGroupsByMapFromCache: () => Promise.resolve([1]),
}));
vi.mock('../lib/logger', () => ({
  default: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { GET } = await import('../app/api/maps/[mapname]/bonuses/route');

const call = (qs: string) => GET(
  new NextRequest(`http://localhost/api/maps/surf_test/bonuses?${qs}`),
  { params: Promise.resolve({ mapname: 'surf_test' }) }
);

beforeEach(() => {
  vi.clearAllMocks();
  getBonusRecordsFromCache.mockResolvedValue({ bonuses: [], pagination: {} });
});

describe('bonus records route', () => {
  // 250 records / 20 per page = 13 pages, so an absurd page must not mint a
  // key (and an OFFSET) beyond the real end of the leaderboard.
  it('clamps page to the real page count', async () => {
    await call('bonus=1&page=10000&pageSize=20');

    expect(getBonusRecordsFromCache).toHaveBeenCalledWith('surf_test', 1, 13, 20);
  });

  it('leaves a real page alone', async () => {
    await call('bonus=1&page=3&pageSize=20');

    expect(getBonusRecordsFromCache).toHaveBeenCalledWith('surf_test', 1, 3, 20);
  });
});
