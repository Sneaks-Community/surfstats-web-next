import 'server-only';
import { warmPlayersListCache } from './player-cache';
import logger from './logger';
import { createBackgroundRefresh } from './background-refresh';

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

const { start: startPlayersListBackgroundRefresh } = createBackgroundRefresh({
  name: 'PlayersListRefresh',
  intervalMs: REFRESH_INTERVAL_MS,
  startupDetail: `${WARM_PAGE_COUNT} pages every ${REFRESH_INTERVAL_MS}ms`,
  task: async () => {
    await warmPlayersListCache(WARM_PAGE_COUNT);
    logger.debug(`[PlayersListRefresh] Warmed first ${WARM_PAGE_COUNT} players-list pages`);
  },
});

/**
 * Start the background players-list warmer.
 * Idempotent — an immediate warm runs on the first call, then periodic warms
 * every {@link REFRESH_INTERVAL_MS}.
 */
export { startPlayersListBackgroundRefresh };
