import 'server-only';
import { cacheGetWithTtl, cacheSet } from './valkey-cache';
import { cacheLock, shouldExpireEarly } from './cache-lock';
import { withExpensiveQueryLimit } from './db-semaphore';
import { waitForCacheReady } from './valkey';
import { CacheUnavailableError, DbBusyError } from './errors';
import logger from './logger';

export { CacheUnavailableError };

/** Fraction of the TTL, measured from the end, in which early refresh may fire. */
const EARLY_REFRESH_WINDOW = 0.1;

/**
 * Put a fetched value through the same JSON round trip a cached one takes, so
 * both paths hand back the same shape. mysql2 returns `DATETIME` as `Date`,
 * which the row types declare as `string`; without this they are wrong on
 * exactly the first request after an expiry.
 */
export function normalizeToCachedShape<T>(value: T): T {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Trailing argument on the cache getters a background refresher owns. */
export interface RefreshOptions {
  force?: boolean;
}

/** Options for {@link cachedFetch}. */
export interface CachedFetchOptions<T> {
  /** Dedupe concurrent misses on one key via {@link cacheLock}, against stampedes. */
  lock?: boolean;
  /** Run `fetchFn` under the global expensive-query cap ({@link withExpensiveQueryLimit}). */
  expensive?: boolean;
  /**
   * Fallback for a failed `fetchFn`, never cached so a transient failure isn't
   * pinned for the TTL. Omitted, the error propagates; {@link DbBusyError}
   * bypasses it either way.
   */
  onError?: (error: unknown) => T;
  /**
   * Skip the read and overwrite the key on success. The old value keeps serving
   * until the new one lands, so a failed refresh is a no-op, not a blank page.
   */
  force?: boolean;
}

/**
 * Whether a still-valid hit should refresh early. Probability ramps from ~0 at
 * the window's edge to ~1 at expiry, so some request renews a hot key before
 * everyone misses at once.
 *
 * @param remainingTtlMs - Remaining PTTL; negative (no key, no expiry) skips
 * @param ttlSeconds - The full TTL the entry was written with
 */
function shouldRefreshEarly(remainingTtlMs: number, ttlSeconds: number): boolean {
  if (remainingTtlMs < 0 || ttlSeconds <= 0) return false;

  const remainingFraction = remainingTtlMs / (ttlSeconds * 1000);
  if (remainingFraction > EARLY_REFRESH_WINDOW) return false;

  const probability = 1 - remainingFraction / EARLY_REFRESH_WINDOW;
  return shouldExpireEarly(probability);
}

/**
 * Refresh `key` without blocking the caller. Locked per key so a foreground
 * miss joins instead of querying again; errors are logged and dropped, since
 * the still-valid value already went out.
 */
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
      logger.warn(
        `[Cache] Background refresh failed for ${key}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
}

/**
 * The get → (lock → recheck →) fetch → set pattern every Valkey-backed cache
 * here shares. `null`/`undefined` is never written, since a stored `null` reads
 * back as a miss.
 *
 * @param key - Fully-qualified Valkey key
 * @param ttl - Time-to-live in seconds
 * @param fetchFn - Loader run on a cache miss
 * @param options - See {@link CachedFetchOptions}
 */
export async function cachedFetch<T>(
  key: string,
  ttl: number,
  fetchFn: () => Promise<T>,
  options: CachedFetchOptions<T> = {}
): Promise<T> {
  // Fail closed rather than hammer the DB, and outside the try/catch so
  // `onError` can't swallow it. Awaited, not `isCacheReady()`: the proxy's gate
  // is a different module scope, so a lazily loaded route races the handshake.
  if (!(await waitForCacheReady())) {
    throw new CacheUnavailableError();
  }

  // An explicit `force: false` (as opposed to absent) is a background refresher
  // reading its own keys first. That pass is paced, so it renews a near-expiry
  // key inline; fanning out one background refresh per key would put a whole
  // sweep's worth of them on the expensive-query semaphore at once.
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

    // Meaningful where T is nullable (profiles resolve to null); the generic
    // just doesn't carry that.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (value !== null && value !== undefined) {
      await cacheSet(key, value, ttl);
    }

    return value;
  };

  try {
    return options.lock ? await cacheLock.acquire(key, load) : await load();
  } catch (error) {
    // Backpressure, not a failed query: an `onError` shape renders as a real
    // answer ("no players found"), so shedding would serve fabricated data.
    if (error instanceof DbBusyError) {
      throw error;
    }
    if (options.onError) {
      return options.onError(error);
    }
    throw error;
  }
}
