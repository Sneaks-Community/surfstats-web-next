import 'server-only';
import logger from './logger';
import { validateEnv } from './env';
import { initializeDatabase } from './db';
import { startAnalyticsHealthCheck } from './db-analytics';
import { startServerBackgroundRefresh } from './server-background-refresh';
import { startPlayersListBackgroundRefresh } from './players-list-background-refresh';
import { startMapGraphPrecache } from './map-graph-precache';

/**
 * Everything that has to happen once per server process, in order.
 *
 * Never awaited: the cache pre-warm and first precache sweep take minutes, and
 * `register()` blocks the server from accepting requests. Until the cache is up,
 * the proxy's gate serves a 503.
 */
export async function startServer(): Promise<void> {
  validateEnv();

  // Non-blocking: flips the analytics feature on when the optional DB answers.
  startAnalyticsHealthCheck();

  const dbReady = await initializeDatabase();

  startServerBackgroundRefresh();
  startPlayersListBackgroundRefresh();

  // Seven aggregate queries per map across ~1,000 maps: skip the sweep if the probe
  // failed, rather than logging a thousand failures.
  if (dbReady) {
    startMapGraphPrecache();
  } else {
    logger.warn('[Startup] Skipping map graph precache: database unreachable at startup');
  }
}
