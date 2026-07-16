import 'server-only';

/**
 * In-process cap on concurrent expensive DB queries so a burst (e.g. scraping
 * uncached keys) can't consume the whole connection pool and starve SSR page
 * rendering. Waiters are released FIFO. In-process only, like the cache lock.
 */

const MAX_CONCURRENT = Math.max(
  1,
  parseInt(process.env.DB_MAX_CONCURRENT_EXPENSIVE || '6', 10) || 6
);

let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
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
}

/** Run `fn` under the global expensive-query concurrency cap. */
export async function withExpensiveQueryLimit<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
