import 'server-only';
import logger from './logger';
import { getErrorMessage } from './errors';
import { onShutdown } from './shutdown';

/**
 * Configuration for {@link createBackgroundRefresh}.
 */
export interface BackgroundRefreshConfig {
  /** Log prefix / identifier, e.g. "ServerRefresh". */
  name: string;
  /** Refresh interval in milliseconds. */
  intervalMs: number;
  /**
   * The refresh work. May throw — errors are caught and logged so a transient
   * failure never crashes the timer or leaves an unhandled rejection.
   */
  task: () => Promise<void>;
  /** Optional extra detail appended to the "started" log line (e.g. page counts). */
  startupDetail?: string;
}

/**
 * A background refresh controller returned by {@link createBackgroundRefresh}.
 */
export interface BackgroundRefresh {
  /**
   * Start the refresh loop: one immediate run, then periodic runs on the
   * configured interval. Idempotent — calling it more than once is a no-op.
   */
  start: () => void;
}

/**
 * Factory for the "run a task now, then on a fixed interval, and clear the timer
 * on shutdown" pattern shared by the server-status and players-list warmers.
 * Extracted from the two near-identical background-refresh modules.
 */
export function createBackgroundRefresh({
  name,
  intervalMs,
  task,
  startupDetail,
}: BackgroundRefreshConfig): BackgroundRefresh {
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  const runTask = async (): Promise<void> => {
    try {
      await task();
    } catch (error) {
      logger.error(`[${name}] Background refresh failed: ${getErrorMessage(error)}`);
    }
  };

  const start = (): void => {
    if (refreshTimer) {
      logger.debug(`[${name}] Background refresh already running`);
      return;
    }

    // Immediate initial run so data is hot right away (runTask swallows errors).
    void runTask();

    refreshTimer = setInterval(() => void runTask(), intervalMs);

    logger.info(
      `[${name}] Background refresh started${startupDetail ? ` (${startupDetail})` : ''}`
    );
  };

  onShutdown(`background-refresh:${name}`, () => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
      logger.info(`[${name}] Background refresh stopped`);
    }
  });

  return { start };
}
