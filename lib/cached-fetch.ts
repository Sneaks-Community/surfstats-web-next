import 'server-only';
import { cacheGetWithTtl, cacheSet } from './valkey-cache';
import { cacheLock, shouldExpireEarly } from './cache-lock';
import { withExpensiveQueryLimit } from './db-semaphore';
import { waitForCacheReady } from './valkey';
import { CacheUnavailableError, DbBusyError, getErrorMessage } from './errors';
import logger from './logger';

export { CacheUnavailableError };

// Fraction of the TTL, measured from the end, in which early refresh may fire.
const EARLY_REFRESH_WINDOW = 0.1;

/**
 * JSON round trip so a fresh fetch has a cache hit's shape: mysql2 returns `DATETIME` as `Date`,
 * which row types declare as `string`, so the first request after an expiry would differ.
 */
export function normalizeToCachedShape<T>(value: T): T {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Trailing argument on the cache getters a background refresher owns. */
export interface RefreshOptions {
  force?: boolean;
}

export interface CachedFetchOptions<T> {
  /** Dedupe concurrent misses on one key via {@link cacheLock}, against stampedes. */
  lock?: boolean;
  /** Run `fetchFn` under the global expensive-query cap ({@link withExpensiveQueryLimit}). */
  expensive?: boolean;
  /**
   * Fallback for a failed fetch; never cached, so a transient failure isn't pinned for the TTL.
   * Omitted, the error propagates; {@link DbBusyError} always propagates.
   */
  onError?: (error: unknown) => T;
  /** Skip the read and overwrite on success; a failed refresh keeps the old value. */
  force?: boolean;
}

// Ramps ~0 at the window's edge to ~1 at expiry, so one request renews a hot key before everyone
// misses at once. A negative PTTL (no key, or no expiry) never refreshes.
function shouldRefreshEarly(remainingTtlMs: number, ttlSeconds: number): boolean {
  if (remainingTtlMs < 0 || ttlSeconds <= 0) return false;

  const remainingFraction = remainingTtlMs / (ttlSeconds * 1000);
  if (remainingFraction > EARLY_REFRESH_WINDOW) return false;

  const probability = 1 - remainingFraction / EARLY_REFRESH_WINDOW;
  return shouldExpireEarly(probability);
}

// Doesn't block the caller; errors are only logged, since the still-valid value already went out.
// Locked per key so a foreground miss joins instead of querying again.
function triggerBackgroundRefresh<T>(
  key: string,
  ttl: number,
  fetchFn: () => Promise<T>,
  expensive: boolean
): void {
  void cacheLock
    .acquire(key, async () => {
      const fetched = await (expensive ? withExpensiveQueryLimit(fetchFn) : fetchFn());
      const value = normalizeToCachedShape(fetched);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (value !== null && value !== undefined) {
        await cacheSet(key, value, ttl);
      }
      return value;
    })
    .catch((error: unknown) => {
      logger.warn(`[Cache] Background refresh failed for ${key}: ${getErrorMessage(error)}`);
    });
}

/**
 * The get → (lock → recheck →) fetch → set path every Valkey cache shares; `ttl` is in seconds.
 * `null`/`undefined` is never written, since a stored `null` reads back as a miss.
 */
export async function cachedFetch<T>(
  key: string,
  ttl: number,
  fetchFn: () => Promise<T>,
  options: CachedFetchOptions<T> = {}
): Promise<T> {
  // Fail closed rather than hammer the DB, outside the try so `onError` can't swallow it.
  // Awaited, not `isCacheReady()`: the proxy's gate is another module scope, so a lazily
  // loaded route races the handshake.
  if (!(await waitForCacheReady())) {
    throw new CacheUnavailableError();
  }

  // Explicit `force: false` (not absent) is a refresher's paced read-first pass: it renews a
  // near-expiry key inline, since one background refresh per key would flood the semaphore.
  const paced = options.force === false;
  let renewing = false;

  if (!options.force) {
    const { value: cached, ttlMs } = await cacheGetWithTtl<T>(key);
    if (cached !== null) {
      if (!shouldRefreshEarly(ttlMs, ttl)) {
        return cached;
      }
      if (!paced) {
        triggerBackgroundRefresh(key, ttl, fetchFn, options.expensive ?? false);
        return cached;
      }
      renewing = true;
    }
  }

  const load = async (): Promise<T> => {
    // A concurrent request may have populated the key while we waited for it.
    if (options.lock && !options.force && !renewing) {
      const { value: rechecked } = await cacheGetWithTtl<T>(key);
      if (rechecked !== null) {
        return rechecked;
      }
    }

    const fetched = await (options.expensive ? withExpensiveQueryLimit(fetchFn) : fetchFn());
    const value = normalizeToCachedShape(fetched);

    // T may be nullable (profiles resolve to null); the generic doesn't carry that.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (value !== null && value !== undefined) {
      await cacheSet(key, value, ttl);
    }

    return value;
  };

  try {
    return options.lock ? await cacheLock.acquire(key, load) : await load();
  } catch (error) {
    // Backpressure, not a failed query: an `onError` shape renders as a real answer ("no
    // players found"), so it would serve fabricated data.


    if (error instanceof DbBusyError) {
      throw error;
    }
    if (options.onError) {
      return options.onError(error);
    }
    throw error;
  }
}
