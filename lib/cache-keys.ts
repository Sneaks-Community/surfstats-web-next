import 'server-only';

/**
 * Cache keys and TTLs that more than one module has to agree on. Duplicated
 * literals drift silently: a precache `DEL` that matches nothing, a warmer writing
 * pages the read path never looks at. Single-owner keys stay with their fetcher.
 */

// Live server status: written by the background refresher, read by the page.
export const SERVER_CACHE_KEY = 'surfstats:server:all';
export const SERVER_CACHE_TTL = 90; // 3x the 30s refresh, so a late write can't leave a hole

// Per-map namespace: built by mapCachedFetch, refreshed by the graph precache.

/** `surfstats:map:<mapname>:<suffix>`. Callers pass a validated map name. */
export function mapKey(mapname: string, suffix: string): string {
  return `surfstats:map:${mapname}:${suffix}`;
}

/** The seven per-map chart series the graph precache refreshes, one key each. */
export const MAP_STATS_SUFFIXES = {
  completions: 'stats:completions',
  timeOnMap: 'stats:time-on-map',
  checkpoints: 'stats:checkpoints',
  finishTime: 'stats:finish-time',
  bonusTime: 'stats:bonus-time',
  percentiles: 'stats:percentiles',
} as const;

/** WR checkpoint times are keyed per checkpoint count, so this one is a function. */
export function wrCheckpointSuffix(maxCheckpoint: number): string {
  return `stats:wr-checkpoint:${maxCheckpoint}`;
}

// Players list: the read path and the background warmer must agree exactly.

/** `search` is the sanitized term; the default (no-search) listing passes `''`. */
export function playersListKey(page: number, search: string): string {
  return `surfstats:players:list:${page}:${search}`;
}

export const PLAYERS_LIST_TTL = 3600; // 1 hour

// Countries ranking: the page asks for one deep slice and the warmer has to ask for
// the same one, since the sort/order/page/limit are all part of the key.
export const COUNTRIES_RANKING_DEFAULT = {
  sort: 'players',
  order: 'desc',
  page: 1,
  limit: 250,
} as const;

// Recently-viewed profiles: a capped sorted set written by the profile read path
// and read by the warmer, which keeps exactly these profiles' keys fresh.
export const RECENT_PROFILES_KEY = 'surfstats:player:recent';
export const RECENT_PROFILES_MAX = 100;

// Steam avatars: read and written on either side of the Steam API call.
export function steamAvatarKey(steamId: string): string {
  return `surfstats:steam:avatar:${steamId}`;
}

export const STEAM_AVATAR_TTL = 604800; // 7 days
