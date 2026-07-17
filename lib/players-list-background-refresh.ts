import 'server-only';
import { warmPlayersListCache } from './player-cache';
import logger from './logger';
import { getErrorMessage } from './errors';

// Number of default (no-search) listing pages to keep warm, and how often.
// Rankings change slowly, so a few-minute interval keeps the browsed pages
// fresh without meaningful load.
const WARM_PAGE_COUNT = Math.max(
  1,
  parseInt(process.env.PLAYERS_LIST_WARM_PAGES || '10', 10) || 10
);
const REFRESH_INTERVAL_MS = Math.max(
  60_000,
  parseInt(process.env.PLAYERS_LIST_WARM_INTERVAL_MS || '', 10) || 300_000 // 5 minutes
);

let refreshTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the background players-list warmer.
 * Idempotent - calling it multiple times is safe. An immediate warm runs on the
 * first call, then periodic warms every {@link REFRESH_INTERVAL_MS}.
 */
export function startPlayersListBackgroundRefresh(): void {
  if (refreshTimer) {
    logger.debug('[PlayersListRefresh] Background refresh already running');
    return;
  }

  // Immediate initial warm so the common pages are hot right away
  refreshPlayersList().catch((err: unknown) => {
    logger.error(`[PlayersListRefresh] Initial warm failed: ${getErrorMessage(err)}`);
  });

  refreshTimer = setInterval(refreshPlayersList, REFRESH_INTERVAL_MS);

  logger.info(
    `[PlayersListRefresh] Background refresh started (${WARM_PAGE_COUNT} pages every ${REFRESH_INTERVAL_MS}ms)`
  );
}

async function refreshPlayersList(): Promise<void> {
  try {
    await warmPlayersListCache(WARM_PAGE_COUNT);
    logger.debug(`[PlayersListRefresh] Warmed first ${WARM_PAGE_COUNT} players-list pages`);
  } catch (error) {
    logger.error(`[PlayersListRefresh] Background refresh failed: ${getErrorMessage(error)}`);
  }
}

// Graceful shutdown cleanup
if (typeof window === 'undefined') {
  process.on('SIGTERM', () => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
      logger.info('[PlayersListRefresh] Background refresh stopped');
    }
  });
}
