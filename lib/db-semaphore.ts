import 'server-only';
import { DbBusyError } from './errors';
import logger from './logger';
import { getEnv } from './env';

// In-process cap (like the cache lock) so a burst of expensive queries can't starve SSR of
// pool connections. Waiters run FIFO. The queue is bounded too: past it we shed with
// DbBusyError (503 via `apiError`; `cachedFetch` rethrows it past `onError`) rather than
// answer callers that already timed out.

const env = getEnv();
const MAX_CONCURRENT = env.DB_MAX_CONCURRENT_EXPENSIVE;

// At the default 2x concurrency the worst-case wait is ~2 query durations, so the tail
// grows with DB_STATEMENT_TIMEOUT_MS.
const MAX_QUEUED = env.DB_MAX_QUEUED_EXPENSIVE ?? MAX_CONCURRENT * 2;

let active = 0;
const waiters: Array<() => void> = [];
// One warn when shedding starts and one with the count when it ends, not one per request.
// Nothing else logs a shed: DbBusyError passes `onError` untouched.
let shedding = false;
let shedCount = 0;
let shedStartedAt = 0;

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  if (waiters.length >= MAX_QUEUED) {
    if (!shedding) {
      shedding = true;
      shedCount = 0;
      shedStartedAt = Date.now();
      logger.warn(
        `[DB] Expensive-query queue full (${active} running, ${waiters.length} waiting), shedding requests`
      );
    }
    shedCount++;
    return Promise.reject(new DbBusyError());
  }
  return new Promise<void>((resolve) => {
    waiters.push(() => {
      active++;
      resolve();
    });
  });
}

function release(): void {
  active--;
  const next = waiters.shift();
  if (next) next();
  if (waiters.length === 0 && shedding) {
    shedding = false;
    logger.warn(
      `[DB] Expensive-query queue drained after ${Date.now() - shedStartedAt}ms, ${shedCount} request(s) shed`
    );
  }
}

/**
 * Run `fn` under the expensive-query concurrency cap.
 * @throws {DbBusyError} When the wait queue is already full, before `fn` runs.
 */
export async function withExpensiveQueryLimit<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
