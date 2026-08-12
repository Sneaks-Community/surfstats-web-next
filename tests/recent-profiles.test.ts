import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RECENT_PROFILES_KEY, RECENT_PROFILES_MAX } from '../lib/cache-keys';

const zAdd = vi.fn();
const zRemRangeByRank = vi.fn();
const exec = vi.fn().mockResolvedValue([]);
const zRange = vi.fn().mockResolvedValue(['STEAM_1:0:1']);

const chain = {
  zAdd: (...args: unknown[]) => {
    zAdd(...args);
    return chain;
  },
  zRemRangeByRank: (...args: unknown[]) => {
    zRemRangeByRank(...args);
    return chain;
  },
  exec,
};

vi.mock('../lib/valkey', () => ({
  default: { multi: () => chain, zRange: (...args: unknown[]) => zRange(...args) },
}));
vi.mock('../lib/logger', () => ({
  default: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { recordProfileView, listRecentProfiles } = await import('../lib/recent-profiles');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recordProfileView', () => {
  // The trim is what bounds the warm set. Off by one and the set grows without
  // limit (or drops the profile just recorded), which only shows up as a warm pass
  // that gets slower every interval.
  it('adds the profile and trims to the newest N in one transaction', () => {
    recordProfileView('STEAM_1:0:1');

    expect(zAdd).toHaveBeenCalledWith(RECENT_PROFILES_KEY, {
      score: expect.any(Number),
      value: 'STEAM_1:0:1',
    });
    expect(zRemRangeByRank).toHaveBeenCalledWith(RECENT_PROFILES_KEY, 0, -(RECENT_PROFILES_MAX + 1));
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('swallows a Valkey failure rather than failing the render', async () => {
    exec.mockRejectedValueOnce(new Error('valkey down'));

    expect(() => { recordProfileView('STEAM_1:0:1'); }).not.toThrow();
    await Promise.resolve();
  });
});

describe('listRecentProfiles', () => {
  it('reads the whole set', async () => {
    expect(await listRecentProfiles()).toEqual(['STEAM_1:0:1']);
    expect(zRange).toHaveBeenCalledWith(RECENT_PROFILES_KEY, 0, -1);
  });
});
