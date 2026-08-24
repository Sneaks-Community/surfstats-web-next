import 'server-only';
import { DbBusyError } from './errors';
import logger from './logger';

/**
 * In-process cap on concurrent expensive DB queries so a burst (e.g. scraping
 * uncached keys) can't consume the whole connection pool and starve SSR page
 * rendering. Waiters are released FIFO. In-process only, like the cache lock.
 *
 * The queue is bounded as well as the concurrency: an unbounded one turns a
 * burst into a growing backlog where request #200 waits behind ~33 rounds of
 * multi-second scans and answers a caller that timed out long ago, while still
 * holding its DB work in the queue. Past the bound we shed instead, throwing
 * {@link DbBusyError} for `apiError` to serve as a 503 (or for a `cachedFetch`
 * `onError` fallback), so the queries already running finish quickly.
 */

const MAX_CONCURRENT = Math.max(
  1,
  parseInt(process.env.DB_MAX_CONCURRENT_EXPENSIVE || '6', 10) || 6
);

/**
 * How many callers may wait for a slot. At the default 2x the concurrency, the
 * worst-case wait is ~2 query durations, which keeps the tail latency inside
 * what a client will still be listening for.
 */
const MAX_QUEUED = Math.max(
  1,
  parseInt(process.env.DB_MAX_QUEUED_EXPENSIVE || '', 10) || MAX_CONCURRENT * 2
);

let active = 0;
const waiters: Array<() => void> = [];
/** One warn per overload episode instead of one per shed request. */
let shedding = false;

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  if (waiters.length >= MAX_QUEUED) {
    if (!shedding) {
      shedding = true;
      logger.warn(
        `[DB] Expensive-query queue full (${active} running, ${waiters.length} waiting), shedding requests`
      );
    }
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
  if (waiters.length === 0) shedding = false;
}

/**
 * Run `fn` under the global expensive-query concurrency cap.
 *
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
