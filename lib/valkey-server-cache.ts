import 'server-only';
import { cachedFetch } from './cached-fetch';
import { fetchServersFromGame } from './cache';
import type { ServerStatus } from './cache';

export type { ServerStatus };

const SERVER_CACHE_KEY = 'surfstats:server:all';
const SERVER_CACHE_TTL = 30; // 30 seconds

/**
 * Get server status from Valkey cache with request deduplication
 * Falls back to GameDig if cache miss
 * Uses CacheLock to prevent cache stampede when multiple requests miss simultaneously
 */
export async function getServersFromCache(): Promise<ServerStatus[]> {
  return cachedFetch(SERVER_CACHE_KEY, SERVER_CACHE_TTL, fetchServersFromGame, { lock: true });
}
