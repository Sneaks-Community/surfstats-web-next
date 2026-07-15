import 'server-only';
import client from './valkey';
import logger from './logger';

// ============================================================
// CACHE OPERATIONS
// ============================================================

/**
 * Get a value from cache
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const cached = await client.get(key);

    if (!cached) {
      logger.debug(`[Cache] Miss: ${key}`);
      return null;
    }
    const value = JSON.parse(cached) as T;
    logger.debug(`[Cache] Hit: ${key}`);
    return value;
  } catch {
    return null;
  }
}

/**
 * Get a value from cache along with its remaining TTL (in milliseconds).
 *
 * Used by the early-expiration logic in {@link cachedFetch}, which needs to
 * know how close a hit is to expiring to decide whether to refresh it ahead
 * of time. `ttlMs` follows Valkey's PTTL convention: `-2` = key missing,
 * `-1` = key exists but has no expiry.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T is the caller-supplied cached value shape, mirroring cacheGet<T>
export async function cacheGetWithTtl<T>(
  key: string
): Promise<{ value: T | null; ttlMs: number }> {
  try {
    const results = await client.multi().get(key).pTTL(key).exec();
    const cached = results[0] as unknown as string | null;
    const ttlMs = Number(results[1]);

    if (!cached) {
      logger.debug(`[Cache] Miss: ${key}`);
      return { value: null, ttlMs: -2 };
    }
    logger.debug(`[Cache] Hit: ${key}`);
    return { value: JSON.parse(cached) as T, ttlMs };
  } catch {
    return { value: null, ttlMs: -2 };
  }
}

/**
 * Set a value in cache
 */
export async function cacheSet(key: string, value: unknown, ttl: number): Promise<void> {
  try {
    const serialized = JSON.stringify(value);
    await client.setEx(key, ttl, serialized);
    logger.debug(`[Cache] SET ${key} with TTL ${ttl}s`);
  } catch {
    // Silently fail - cache is optional
  }
}

