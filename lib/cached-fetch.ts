import 'server-only';
import { cacheGet, cacheSet } from './valkey-cache';
import { cacheLock } from './cache-lock';

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
   * Called if `fetchFn` throws. Return a fallback value to hand back to the
   * caller. The fallback is intentionally NOT cached, so a transient failure
   * doesn't get pinned for the whole TTL. If omitted, the error propagates.
   */
  onError?: (error: unknown) => T;
}

/**
 * Generic cache wrapper implementing the get → (lock → recheck →) fetch → set
 * pattern shared by every Valkey-backed cache in this project.
 *
 * Behavior:
 * - On cache hit (any value other than `null`, including empty arrays/objects)
 *   the cached value is returned directly.
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
  const cached = await cacheGet<T>(key);
  if (cached !== null) {
    return cached;
  }

  const load = async (): Promise<T> => {
    // Re-check inside the lock: a concurrent request may have populated the
    // cache while we waited to acquire it.
    if (options.lock) {
      const rechecked = await cacheGet<T>(key);
      if (rechecked !== null) {
        return rechecked;
      }
    }

    const value = await fetchFn();

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
