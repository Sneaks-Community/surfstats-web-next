import 'server-only';
import { cacheGet, cacheSet, cacheInvalidatePattern } from './valkey-cache';
import { fetchServersFromGame } from './cache';
import type { ServerStatus } from './cache';
import { cacheLock, shouldExpireEarly } from './cache-lock';
import logger from './logger';

export type { ServerStatus };

const SERVER_CACHE_KEY = 'surfstats:server:all';
const SERVER_CACHE_TTL = 30; // 30 seconds

/**
 * Get server status from Valkey cache with request deduplication
 * Falls back to GameDig if cache miss
 * Uses CacheLock to prevent cache stampede when multiple requests miss simultaneously
 */
export async function getServersFromCache(): Promise<ServerStatus[]> {
  const cached = await cacheGet<ServerStatus[]>(SERVER_CACHE_KEY);

  if (cached) {
    logger.debug('[ServerCache] Valkey cache hit for servers');
    return cached;
  }

  // Probabilistic early expiration to prevent synchronized cache expiration
  if (shouldExpireEarly(0.15)) {
    logger.debug('[ServerCache] Early expiration triggered for servers');
  }

  // Use cache lock to prevent concurrent GameDig queries
  return cacheLock.acquire(SERVER_CACHE_KEY, async () => {
    // Double-check cache after acquiring lock
    const rechecked = await cacheGet<ServerStatus[]>(SERVER_CACHE_KEY);
    if (rechecked) {
      logger.debug('[ServerCache] Cache hit after lock acquisition');
      return rechecked;
    }

    logger.debug('[ServerCache] Cache miss, fetching from GameDig...');

    // Fetch from GameDig
    const servers = await fetchServersFromGame();

    // Cache the result
    await cacheSet(SERVER_CACHE_KEY, servers, SERVER_CACHE_TTL);

    logger.debug(`[ServerCache] Cached ${servers.length} servers with TTL ${SERVER_CACHE_TTL}s`);

    return servers;
  });
}

/**
 * Invalidate server cache
 */
export async function invalidateServerCache(): Promise<void> {
  await cacheInvalidatePattern('surfstats:server:*');
}
