// Dedupes concurrent cache misses so only one DB query runs per key (cache stampede guard),
// which matters for hot keys like player profiles and dashboard stats.

class CacheLock {
  private locks = new Map<string, Promise<unknown>>();

  /** Concurrent callers for the same key share the first caller's promise. */
  async acquire<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const existingLock = this.locks.get(key);
    if (existingLock) {
      return existingLock as Promise<T>;
    }

    // Everyone awaits this same promise, so a rejection is always observed (never unhandled).
    const promise = factory();
    this.locks.set(key, promise);

    try {
      return await promise;
    } finally {
      this.locks.delete(key);
    }
  }
}

export const cacheLock = new CacheLock();

/**
 * True with `probability` (0-1). `cachedFetch` passes a rising value as a hot key nears expiry,
 * so some request refreshes it early instead of everyone missing at once.
 */
export function shouldExpireEarly(probability = 0.1): boolean {

  return Math.random() < probability;
}
