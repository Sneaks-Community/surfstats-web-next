import 'server-only';
import logger from './logger';
import { getErrorMessage } from './errors';
import { onShutdown } from './shutdown';

export interface BackgroundRefreshConfig {
  /** Log prefix and registry key, e.g. "ServerRefresh". */
  name: string;
  /** Refresh interval in ms; `<= 0` runs the task once at startup, no timer. */
  intervalMs: number;
  /**
   * `startup` is true on the boot run only, so a task can read-first (skip keys within TTL) and
   * force on ticks. May throw: errors are logged and never kill the timer.
   */
  task: (ctx: { startup: boolean }) => Promise<void>;
  /** Appended to the "started" log line (e.g. page counts). */
  startupDetail?: string;
}

export interface BackgroundRefresh {
  /** One immediate run, then the interval. Idempotent. */
  start: () => void;
}

// On globalThis: Next evaluates lib modules in several bundles per process, so a
// module-scoped handle would let each copy start its own refresher.
const globalForRefresh = globalThis as unknown as {
  __surfstatsRefreshTimers?: Map<string, ReturnType<typeof setInterval> | 'once'>;
};

const timers = (globalForRefresh.__surfstatsRefreshTimers ??= new Map());

/**
 * Runs `task` now, then every `intervalMs`, clearing the timer on shutdown. Every recurring
 * background task goes through here.
 */
export function createBackgroundRefresh({
  name,
  intervalMs,
  task,
  startupDetail,
}: BackgroundRefreshConfig): BackgroundRefresh {
  let running = false;

  const runTask = async (startup: boolean): Promise<void> => {
    // Don't stack sweeps: a slow run compounds DB load exactly when the DB is slow.
    if (running) {
      logger.warn(`[${name}] Previous refresh still in flight, skipping this tick`);
      return;
    }
    running = true;
    try {
      await task({ startup });
    } catch (error) {
      logger.error(`[${name}] Background refresh failed: ${getErrorMessage(error)}`);
    } finally {
      running = false;
    }
  };

  const start = (): void => {
    if (timers.has(name)) {
      logger.debug(`[${name}] Background refresh already running`);
      return;
    }

    // Claim the slot before the first run so a double-call can't start two copies.
    timers.set(name, 'once');

    // Warm right away; `void` is safe since runTask swallows errors.
    void runTask(true);


    if (intervalMs <= 0) {
      logger.info(`[${name}] Ran once at startup, periodic refresh disabled`);
      return;
    }

    timers.set(name, setInterval(() => void runTask(false), intervalMs));

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
