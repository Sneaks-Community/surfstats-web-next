import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheGet = vi.fn();
const cacheSet = vi.fn();

vi.mock('../lib/valkey-cache', () => ({
  cacheGet: (key: string) => cacheGet(key),
  cacheSet: (key: string, value: unknown, ttl: number) => cacheSet(key, value, ttl),
  cacheGetWithTtl: vi.fn(),
}));
vi.mock('../lib/logger', () => ({
  default: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const {
  convertSteamId2ToSteamId3Numeric,
  convertSteamIdTo64,
  getSteamProfileUrl,
  getSteamProfilesFromCache,
} = await import('../lib/steam');

describe('convertSteamIdTo64', () => {
  it('converts SteamID2 using the known base offset', () => {
    expect(convertSteamIdTo64('STEAM_1:0:12345')).toBe('76561197960290418');
    expect(convertSteamIdTo64('STEAM_0:1:1')).toBe('76561197960265731');
    expect(convertSteamIdTo64('STEAM_1:0:0')).toBe('76561197960265728');
  });

  it('stays exact past 2^53, where Number would round', () => {
    expect(convertSteamIdTo64('STEAM_1:1:2147483647')).toBe('76561202255233023');
  });

  it('returns null for anything that is not SteamID2', () => {
    for (const bad of ['76561197960290418', 'STEAM_1:2:5', 'STEAM_6:0:5', '', 'garbage']) {
      expect(convertSteamIdTo64(bad)).toBeNull();
    }
  });
});

describe('convertSteamId2ToSteamId3Numeric', () => {
  it('computes Z * 2 + Y', () => {
    expect(convertSteamId2ToSteamId3Numeric('STEAM_1:0:95515509')).toBe(191031018);
    expect(convertSteamId2ToSteamId3Numeric('STEAM_1:1:95515509')).toBe(191031019);
    expect(convertSteamId2ToSteamId3Numeric('nope')).toBeNull();
  });
});

describe('getSteamProfileUrl', () => {
  it('accepts either SteamID form and rejects the rest', () => {
    expect(getSteamProfileUrl('76561197960290418')).toBe(
      'https://steamcommunity.com/profiles/76561197960290418'
    );
    expect(getSteamProfileUrl('STEAM_1:0:12345')).toBe(
      'https://steamcommunity.com/profiles/76561197960290418'
    );
    expect(getSteamProfileUrl('not-an-id')).toBeNull();
  });
});

// DRY-1: the redundant first conversion pass was deleted. These lock in the
// behaviour that pass was providing.
describe('getSteamProfilesFromCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    cacheGet.mockResolvedValue(null);
    cacheSet.mockResolvedValue(undefined);
  });

  it('returns an empty map without touching the cache or Steam', async () => {
    const result = await getSteamProfilesFromCache([]);

    expect(result.size).toBe(0);
    expect(cacheGet).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never calls Steam when no SteamID converts', async () => {
    const result = await getSteamProfilesFromCache(['garbage', '']);

    expect(result.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('serves cached avatars without calling Steam', async () => {
    const avatars = { avatar: 'a', avatarmedium: 'm', avatarfull: 'f' };
    cacheGet.mockResolvedValue(avatars);

    const result = await getSteamProfilesFromCache(['STEAM_1:0:12345']);

    expect(result.get('STEAM_1:0:12345')).toEqual(avatars);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches, maps back to the original SteamID, and caches the result', async () => {
    process.env.STEAM_API_KEY = 'test-key';
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          response: {
            players: [
              {
                steamid: '76561197960290418',
                avatar: 'a',
                avatarmedium: 'm',
                avatarfull: 'f',
              },
            ],
          },
        }),
    } as unknown as Response);

    const result = await getSteamProfilesFromCache(['STEAM_1:0:12345', 'garbage']);

    expect(result.get('STEAM_1:0:12345')).toEqual({
      avatar: 'a',
      avatarmedium: 'm',
      avatarfull: 'f',
    });
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('steamids=76561197960290418');
    expect(cacheSet).toHaveBeenCalledWith(
      'surfstats:steam:avatar:STEAM_1:0:12345',
      { avatar: 'a', avatarmedium: 'm', avatarfull: 'f' },
      604800
    );
  });
});
