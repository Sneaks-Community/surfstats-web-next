import 'server-only';

/**
 * Cache keys and TTLs that more than one module has to agree on. Duplicated
 * literals drift silently: a precache `DEL` that matches nothing, a warmer writing
 * pages the read path never looks at. Single-owner keys stay with their fetcher.
 */

// Live server status: written by the background refresher, read by the page.
export const SERVER_CACHE_KEY = 'surfstats:server:all';
export const SERVER_CACHE_TTL = 90; // 3x the 30s refresh, so a late write can't leave a hole

/** `surfstats:map:<mapname>:<suffix>`. Callers pass a validated map name. */
export function mapKey(mapname: string, suffix: string): string {
  return `surfstats:map:${mapname}:${suffix}`;
}
