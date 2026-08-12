import 'server-only';
import { fetchServersFromGame } from './cache';
import { cacheSet } from './valkey-cache';
import logger from './logger';
import { createBackgroundRefresh } from './background-refresh';
import { SERVER_CACHE_KEY, SERVER_CACHE_TTL } from './cache-keys';

const REFRESH_INTERVAL_MS = 30_000; // 30 seconds

const { start: startServerBackgroundRefresh } = createBackgroundRefresh({
  name: 'ServerRefresh',
  intervalMs: REFRESH_INTERVAL_MS,
  task: async () => {
    const servers = await fetchServersFromGame();
    await cacheSet(SERVER_CACHE_KEY, servers, SERVER_CACHE_TTL);
    logger.debug(`[ServerRefresh] Cached ${servers.length} servers with TTL ${SERVER_CACHE_TTL}s`);
  },
});

/**
 * Start the background server refresh timer.
 * Idempotent — an immediate fetch runs on the first call, then periodic fetches
 * every 30 seconds.
 */
export { startServerBackgroundRefresh };
