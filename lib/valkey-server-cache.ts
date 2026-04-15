import 'server-only';
import { cacheGet, cacheSet, cacheInvalidatePattern } from './valkey-cache';
import { fetchServersFromGame } from './cache';
import type { ServerStatus } from './cache';

const SERVER_CACHE_KEY = 'surfstats:server:all';
const SERVER_CACHE_TTL = 30; // 30 seconds

/**
 * Get server status from cache or fetch from GameDig
 */
export async function getServersFromCache(): Promise<ServerStatus[]> {
  const cached = await cacheGet<ServerStatus[]>(SERVER_CACHE_KEY);

  if (cached) {
    return cached;
  }

  // Fetch from GameDig
  const servers = await fetchServersFromGame();

  // Cache the result
  await cacheSet(SERVER_CACHE_KEY, servers, SERVER_CACHE_TTL);

  return servers;
}

/**
 * Invalidate server cache
 */
export async function invalidateServerCache(): Promise<void> {
  await cacheInvalidatePattern('surfstats:server:*');
}
