import 'server-only';
import { cacheGetWithTtl, cacheSet } from './valkey-cache';
import { cacheLock, shouldExpireEarly } from './cache-lock';
import { withExpensiveQueryLimit } from './db-semaphore';
import logger from './logger';

/**
 * Fraction of the TTL, measured from the end, during which a hit becomes
 * eligible for probabilistic early refresh. With `0.1`, only hits in the
 * final 10% of their lifetime can trigger a background refresh; earlier hits
 * are always served straight from cache with no extra work.
 */
const EARLY_REFRESH_WINDOW = 0.1;

/**
 * Options for {@link cachedFetch}.
 */
export interface CachedFetchOptions<T> {
  /**
   * Dedupe concurrent cache misses with the in-process {@link cacheLock}.
   *
   * When enabled, only one caller runs `fetchFn` for a given key at a time;
   * the rest await the same promise. Use this for expensive fetches (heavy DB
   * scans, GameDig queries) that would otherwise stampede on a hot-key miss.
   */
  lock?: boolean;
  /**
   * Run `fetchFn` under the global expensive-query concurrency cap
   * ({@link withExpensiveQueryLimit}) so a burst of misses can't exhaust the DB
   * pool. Use for heavy window-function/scan queries.
   */
  expensive?: boolean;
  /**
   * Called if `fetchFn` throws. Return a fallback value to hand back to the
   * caller. The fallback is intentionally NOT cached, so a transient failure
   * doesn't get pinned for the whole TTL. If omitted, the error propagates.
   */
  onError?: (error: unknown) => T;
}

/**
 * Decide whether a still-valid cache hit should be refreshed early.
 *
 * Returns false until the entry is within the final {@link EARLY_REFRESH_WINDOW}
 * of its TTL. Inside that window the probability of refreshing ramps linearly
 * from ~0 (just entered the window) to ~1 (about to expire), so across the many
 * requests that hit a hot key some request almost always refreshes it *before*
 * it expires — closing the gap where everyone misses at once (plan item COR-2).
 *
 * @param remainingTtlMs - Remaining TTL from Valkey PTTL (ms). Negative means
 *   no key / no expiry, in which case early refresh is skipped.
 * @param ttlSeconds - The full TTL the entry was written with.
 */
function shouldRefreshEarly(remainingTtlMs: number, ttlSeconds: number): boolean {
  if (remainingTtlMs < 0 || ttlSeconds <= 0) return false;

  const remainingFraction = remainingTtlMs / (ttlSeconds * 1000);
  if (remainingFraction > EARLY_REFRESH_WINDOW) return false;

  // 0 at the window's outer edge → 1 as remaining approaches 0.
  const probability = 1 - remainingFraction / EARLY_REFRESH_WINDOW;
  return shouldExpireEarly(probability);
}

/**
 * Kick off a background refresh of `key` without blocking the caller.
 *
 * Wrapped in {@link cacheLock} so that, within this process, only one refresh
 * runs per key no matter how many requests trip the early-expiration roll while
 * it's in flight. Errors are logged and swallowed — the current (still-valid)
 * cached value has already been returned to the user, so a failed refresh is
 * non-fatal; the entry simply gets another chance on the next request or its
 * eventual hard expiry.
 */
function triggerBackgroundRefresh<T>(
  key: string,
  ttl: number,
  fetchFn: () => Promise<T>
): void {
  void cacheLock
    .acquire(`refresh:${key}`, async () => {
      const value = await fetchFn();
      // Mirror the foreground guard: never persist null/undefined.
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
 * Generic cache wrapper implementing the get → (lock → recheck →) fetch → set
 * pattern shared by every Valkey-backed cache in this project.
 *
 * Behavior:
 * - On cache hit (any value other than `null`, including empty arrays/objects)
 *   the cached value is returned directly. If the hit is within the final
 *   {@link EARLY_REFRESH_WINDOW} of its TTL, a probabilistic background refresh
 *   may be triggered (see {@link shouldRefreshEarly}) so the entry is renewed
 *   before it expires (plan item COR-2). The refresh never delays the caller.
 * - On miss, `fetchFn` runs and its result is cached under `key` for `ttl`
 *   seconds, then returned.
 * - `null`/`undefined` results are never written to the cache: a stored `null`
 *   is indistinguishable from a miss on read, so caching it is pointless churn.
 *   This preserves the "only cache a real value" behavior used across the
 *   callers and is the single place negative caching would be added (COR-5).
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
  const { value: cached, ttlMs } = await cacheGetWithTtl<T>(key);
  if (cached !== null) {
    if (shouldRefreshEarly(ttlMs, ttl)) {
      triggerBackgroundRefresh(key, ttl, fetchFn);
    }
    return cached;
  }

  const load = async (): Promise<T> => {
    // Re-check inside the lock: a concurrent request may have populated the
    // cache while we waited to acquire it.
    if (options.lock) {
      const { value: rechecked } = await cacheGetWithTtl<T>(key);
      if (rechecked !== null) {
        return rechecked;
      }
    }

    const value = await (options.expensive ? withExpensiveQueryLimit(fetchFn) : fetchFn());

    // Guard is meaningful at call sites where T is nullable (e.g. player
    // profiles resolve to null, WR checkpoints to undefined); the generic T
    // here just doesn't carry that information.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (value !== null && value !== undefined) {
      await cacheSet(key, value, ttl);
    }

    return value;
  };

  try {
    return options.lock ? await cacheLock.acquire(key, load) : await load();
  } catch (error) {
    if (options.onError) {
      return options.onError(error);
    }
    throw error;
  }
}
