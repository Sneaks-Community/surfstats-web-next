import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheGetMany = vi.fn();
const cacheSetMany = vi.fn();

vi.mock('../lib/valkey-cache', () => ({
  cacheGetMany: (keys: string[]) => cacheGetMany(keys),
  cacheSetMany: (entries: unknown, ttl: number) => cacheSetMany(entries, ttl),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheGetWithTtl: vi.fn(),
}));
vi.mock('../lib/logger', () => ({
  default: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { default: logger } = await import('../lib/logger');

/** The request URL of the nth fetch call, whichever form it was passed in. */
const fetchUrl = (index: number): string => {
  const arg = vi.mocked(fetch).mock.calls[index][0];
  if (typeof arg === 'string') return arg;
  return arg instanceof URL ? arg.href : arg.url;
};

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

// Lock in the SteamID conversion behaviour the cache lookup depends on.
describe('getSteamProfilesFromCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    cacheGetMany.mockImplementation((keys: string[]) => Promise.resolve(keys.map(() => null)));
    cacheSetMany.mockResolvedValue(undefined);
  });

  it('returns an empty map without touching the cache or Steam', async () => {
    const result = await getSteamProfilesFromCache([]);

    expect(result.size).toBe(0);
    expect(cacheGetMany).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never calls Steam when no SteamID converts', async () => {
    const result = await getSteamProfilesFromCache(['garbage', '']);

    expect(result.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('serves cached avatars without calling Steam', async () => {
    const avatars = { avatar: 'a', avatarmedium: 'm', avatarfull: 'f' };
    cacheGetMany.mockResolvedValue([avatars]);

    const result = await getSteamProfilesFromCache(['STEAM_1:0:12345']);

    expect(result.get('STEAM_1:0:12345')).toEqual(avatars);
    expect(fetch).not.toHaveBeenCalled();
  });

  // One round trip for the whole page, not one per row.
  it('reads every SteamID in a single cache call', async () => {
    const ids = ['STEAM_1:0:1', 'STEAM_1:0:2', 'STEAM_1:0:3'];
    await getSteamProfilesFromCache(ids);

    expect(cacheGetMany).toHaveBeenCalledTimes(1);
    expect(cacheGetMany).toHaveBeenCalledWith(ids.map((id) => `surfstats:steam:avatar:${id}`));
  });

  // Results are matched back by position, so a partial hit must not
  // shift avatars onto the wrong players.
  it('maps a partial cache hit back to the right SteamIDs', async () => {
    const second = { avatar: 'b', avatarmedium: 'b', avatarfull: 'b' };
    cacheGetMany.mockResolvedValue([null, second, null]);
    process.env.STEAM_API_KEY = 'test-key';
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: { players: [] } }),
    } as unknown as Response);

    const result = await getSteamProfilesFromCache(['STEAM_1:0:1', 'STEAM_1:0:2', 'STEAM_1:0:3']);

    expect(result.get('STEAM_1:0:2')).toEqual(second);
    expect(result.has('STEAM_1:0:1')).toBe(false);
    expect(result.has('STEAM_1:0:3')).toBe(false);
    // Only the two misses are asked of Steam.
    expect(fetchUrl(0)).toContain('steamids=76561197960265730,76561197960265734');
  });

  // Steam caps GetPlayerSummaries at 100 IDs and drops the remainder.
  it('chunks more than 100 uncached IDs into separate requests', async () => {
    process.env.STEAM_API_KEY = 'test-key';
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: { players: [] } }),
    } as unknown as Response);

    const ids = Array.from({ length: 250 }, (_, i) => `STEAM_1:0:${i + 1}`);
    await getSteamProfilesFromCache(ids);

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
    for (let i = 0; i < vi.mocked(fetch).mock.calls.length; i++) {
      const count = fetchUrl(i).split('steamids=')[1].split(',').length;
      expect(count).toBeLessThanOrEqual(100);
    }
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
    expect(fetchUrl(0)).toContain('steamids=76561197960290418');
    expect(cacheSetMany).toHaveBeenCalledWith(
      [
        {
          key: 'surfstats:steam:avatar:STEAM_1:0:12345',
          value: { avatar: 'a', avatarmedium: 'm', avatarfull: 'f' },
        },
      ],
      604800
    );
  });
});

// The key travels in the query string, and some fetch failures put the
// request URL in the error message.
describe('Steam API key redaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheGetMany.mockImplementation((keys: string[]) => Promise.resolve(keys.map(() => null)));
    cacheSetMany.mockResolvedValue(undefined);
  });

  it('never writes the key into a log line', async () => {
    process.env.STEAM_API_KEY = 'super-secret-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(
        new Error(
          'request to https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=super-secret-key&steamids=1 failed'
        )
      )
    );

    await getSteamProfilesFromCache(['STEAM_1:0:12345']);

    const logged = vi.mocked(logger.error).mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toContain('super-secret-key');
    expect(logged).toContain('key=***');
  });
});
