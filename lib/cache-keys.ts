import 'server-only';

// Keys and TTLs more than one module must agree on, since duplicated literals drift silently.
// Single-owner keys stay with their fetcher.

// Live server status: written by the background refresher, read by the page.
export const SERVER_CACHE_KEY = 'surfstats:server:all';
export const SERVER_CACHE_TTL = 90; // 3x the 30s refresh, so a late write can't leave a hole

/** Callers pass a validated map name. */
export function mapKey(mapname: string, suffix: string): string {
  return `surfstats:map:${mapname}:${suffix}`;
}
