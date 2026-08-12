import 'server-only';
import logger from './logger';
import { getErrorMessage } from './errors';
import { onShutdown } from './shutdown';

/**
 * Configuration for {@link createBackgroundRefresh}.
 */
export interface BackgroundRefreshConfig {
  /** Log prefix / identifier, e.g. "ServerRefresh". Also the registry key. */
  name: string;
  /** Refresh interval in ms; `<= 0` runs the task once at startup, no timer. */
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

// Timers live on globalThis: Next evaluates lib modules in several bundles per
// process, so a module-scoped handle would let each copy start its own refresher.
// Same shape as the registry in lib/shutdown.ts.
const globalForRefresh = globalThis as unknown as {
  __surfstatsRefreshTimers?: Map<string, ReturnType<typeof setInterval> | 'once'>;
};

const timers = (globalForRefresh.__surfstatsRefreshTimers ??= new Map());

/**
 * Run a task now, then on a fixed interval, clearing the timer on shutdown.
 * Every background task in the app goes through here.
 */
export function createBackgroundRefresh({
  name,
  intervalMs,
  task,
  startupDetail,
}: BackgroundRefreshConfig): BackgroundRefresh {
  const runTask = async (): Promise<void> => {
    try {
      await task();
    } catch (error) {
      logger.error(`[${name}] Background refresh failed: ${getErrorMessage(error)}`);
    }
  };

  const start = (): void => {
    if (timers.has(name)) {
      logger.debug(`[${name}] Background refresh already running`);
      return;
    }

    // Claim the slot before the first run so a double-call can't start two copies.
    timers.set(name, 'once');

    // Immediate initial run so data is hot right away (runTask swallows errors).
    void runTask();

    if (intervalMs <= 0) {
      logger.info(`[${name}] Ran once at startup, periodic refresh disabled`);
      return;
    }

    timers.set(name, setInterval(() => void runTask(), intervalMs));

    logger.info(
      `[${name}] Background refresh started${startupDetail ? ` (${startupDetail})` : ''}`
    );
  };

  onShutdown(`background-refresh:${name}`, () => {
    const timer = timers.get(name);
    timers.delete(name);
    if (timer && timer !== 'once') {
      clearInterval(timer);
      logger.info(`[${name}] Background refresh stopped`);
    }
  });

  return { start };
}
