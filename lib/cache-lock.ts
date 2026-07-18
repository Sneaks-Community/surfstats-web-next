/**
 * Cache Lock - Request Deduplication for Cache Misses
 *
 * Prevents cache stampede by ensuring only one database query runs
 * for a given cache key, even when multiple requests miss the cache simultaneously.
 *
 * This is critical for high-traffic endpoints like player profiles and dashboard stats.
 */

/**
 * CacheLock provides request deduplication for cache misses.
 *
 * When multiple requests miss the cache simultaneously, this class ensures
 * only one database query is executed, and all waiting requests share the result.
 *
 * @example
 * const lock = new CacheLock();
 *
 * export async function getCachedData(key: string, fetchFn: () => Promise<Data>): Promise<Data> {
 *   const cached = await cacheGet<Data>(key);
 *   if (cached) return cached;
 *
 *   return lock.acquire(key, fetchFn);
 * }
 */
export class CacheLock {
  private locks = new Map<string, Promise<unknown>>();

  /**
   * Acquires a lock for a given key and executes the factory function.
   * If a lock already exists for the key, returns the existing promise.
   *
   * @param key - Unique identifier for the cache entry
   * @param factory - Function that returns a promise to execute when lock is acquired
   * @returns Promise that resolves to the result of the factory function
   */
  async acquire<T>(key: string, factory: () => Promise<T>): Promise<T> {
    // Check if lock already exists
    const existingLock = this.locks.get(key);
    if (existingLock) {
      return existingLock as Promise<T>;
    }

    // Store the factory's promise directly. The creator and any concurrent
    // waiters all await this same promise, so a rejection is always observed
    // by at least one handler (no unhandled rejection on the uncontended path).
    const promise = factory();
    this.locks.set(key, promise);

    try {
      return await promise;
    } finally {
      // Clean up lock entry
      this.locks.delete(key);
    }
  }

  /**
   * Gets the number of currently active locks.
   * Useful for monitoring and debugging.
   */
  get activeLockCount(): number {
    return this.locks.size;
  }

  /**
   * Clears all locks.
   * Useful for testing or emergency situations.
   */
  clear(): void {
    this.locks.clear();
  }
}

// Export a singleton instance for global use
export const cacheLock = new CacheLock();

/**
 * Probabilistic early expiration helper.
 * 
 * Returns true with the given probability. Driven by `cachedFetch`'s
 * early-refresh logic: as a hot key nears expiry, callers pass a
 * rising probability so that some request refreshes the entry in the
 * background *before* it expires, avoiding a synchronized-miss stampede.
 * 
 * @param probability - Probability of returning true (0-1, default 0.1 = 10%)
 * @returns true if the entry should be refreshed early, false otherwise
 */
export function shouldExpireEarly(probability = 0.1): boolean {
  return Math.random() < probability;
}
