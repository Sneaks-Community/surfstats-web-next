import 'server-only';
import logger from './logger';
import { validateEnv } from './env';
import { initializeDatabase } from './db';
import { startAnalyticsHealthCheck } from './db-analytics';
import { startMapGraphPrecache } from './map-graph-precache';
import { startCacheRefreshers } from './cache-background-refresh';

/**
 * Once-per-process startup, in order. Never awaited: warming takes minutes and `register()`
 * blocks serving; the proxy's gate serves a 503 until the cache is up.
 */
export async function startServer(): Promise<void> {
  validateEnv();

  // Non-blocking; enables analytics once the optional DB answers.
  startAnalyticsHealthCheck();

  const dbReady = await initializeDatabase();

  // Each first run is its cache warm. Started even if the probe failed, so a late DB heals
  // on the next interval instead of needing a restart.
  startCacheRefreshers();

  // ~7 queries per map across ~1,000 maps: skip rather than log a thousand failures.
  if (dbReady) {
    startMapGraphPrecache();
  } else {
    logger.warn('[Startup] Skipping map graph precache: database unreachable at startup');
  }
}
