import 'server-only';
import { fetchServersFromGame } from './cache';
import { cacheSet } from './valkey-cache';
import logger from './logger';

const SERVER_CACHE_KEY = 'surfstats:server:all';
const SERVER_CACHE_TTL = 30; // 30 seconds
const REFRESH_INTERVAL_MS = 30_000; // 30 seconds

let refreshTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the background server refresh timer.
 * This function is idempotent - calling it multiple times is safe.
 * An immediate fetch runs on first call, then periodic fetches every 30 seconds.
 */
export function startServerBackgroundRefresh(): void {
  if (refreshTimer) {
    logger.debug('[ServerRefresh] Background refresh already running');
    return;
  }

  // Immediate initial fetch so data is available right away
  refreshServers();

  // Periodic refresh every 30 seconds
  refreshTimer = setInterval(refreshServers, REFRESH_INTERVAL_MS);

  logger.info('[ServerRefresh] Background refresh started');
}

async function refreshServers(): Promise<void> {
  try {
    const servers = await fetchServersFromGame();
    await cacheSet(SERVER_CACHE_KEY, servers, SERVER_CACHE_TTL);
    logger.debug(`[ServerRefresh] Cached ${servers.length} servers with TTL ${SERVER_CACHE_TTL}s`);
  } catch (error) {
    const err = error as { message?: string };
    logger.error(`[ServerRefresh] Background refresh failed: ${err.message || 'Unknown error'}`);
  }
}

// Graceful shutdown cleanup
if (typeof window === 'undefined') {
  process.on('SIGTERM', () => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
      logger.info('[ServerRefresh] Background refresh stopped');
    }
  });
}
