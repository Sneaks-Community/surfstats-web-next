import 'server-only';
import { cachedFetch } from './cached-fetch';
import { fetchServersFromGame } from './cache';
import type { ServerStatus } from './cache';
import { SERVER_CACHE_KEY, SERVER_CACHE_TTL } from './cache-keys';

export type { ServerStatus };

/**
 * Get server status from Valkey cache with request deduplication
 * Falls back to GameDig if cache miss
 * Uses CacheLock to prevent cache stampede when multiple requests miss simultaneously
 */
export async function getServersFromCache(): Promise<ServerStatus[]> {
  return cachedFetch(SERVER_CACHE_KEY, SERVER_CACHE_TTL, fetchServersFromGame, { lock: true });
}
