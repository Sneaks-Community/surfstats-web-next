/**
 * Cache Lock - Request Deduplication for Cache Misses
 *
 * Prevents cache stampede by ensuring only one database query runs
 * for a given cache key, even when multiple requests miss the cache simultaneously.
 *
 * This is critical for high-traffic endpoints like player profiles and dashboard stats.
 */

interface CacheLockEntry {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

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
  private locks = new Map<string, CacheLockEntry>();

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
      return existingLock.promise as Promise<T>;
    }

    // Create new lock entry
    let resolveFn: (value: unknown) => void;
    let rejectFn: (reason?: unknown) => void;

    const promise = new Promise<unknown>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    const lockEntry: CacheLockEntry = { promise, resolve: resolveFn!, reject: rejectFn! };
    this.locks.set(key, lockEntry);

    try {
      // Execute the factory function
      const result = await factory();
      lockEntry.resolve(result);
      return result as T;
    } catch (error) {
      lockEntry.reject(error);
      throw error;
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
 * Randomly expires a subset of cache entries to prevent synchronized
 * cache expiration storms (cache stampede).
 * 
 * @param probability - Probability of early expiration (0-1, default 0.1 = 10%)
 * @returns true if should expire early, false otherwise
 */
export function shouldExpireEarly(probability = 0.1): boolean {
  return Math.random() < probability;
}

/**
 * Gets a cache key with probabilistic early expiration.
 * 
 * Returns null if the cache should be considered expired early,
 * forcing a database fetch and preventing synchronized expiration.
 * 
 * @param cachedValue - The cached value (null means cache miss)
 * @param probability - Probability of early expiration (0-1, default 0.1)
 * @returns The cached value or null if should expire early
 */
export function getWithEarlyExpiration<T>(
  cachedValue: T | null,
  probability = 0.1
): T | null {
  if (cachedValue !== null) {
    return cachedValue;
  }
  
  // Cache miss - check if we should expire early
  if (shouldExpireEarly(probability)) {
    return null;
  }
  
  return cachedValue;
}
