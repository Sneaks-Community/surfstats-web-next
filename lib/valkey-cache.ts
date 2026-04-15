import 'server-only';
import client from './valkey';
import logger from './logger';

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
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error(`[Cache] GET error for ${key}: ${err.message || 'Unknown error'}`);
    return null;
  }
}

/**
 * Set a value in cache with TTL
 */
export async function cacheSet<T>(key: string, value: T, ttl: number): Promise<void> {
  try {
    await client.setEx(key, ttl, JSON.stringify(value));
    logger.debug(`[Cache] SET ${key} with TTL ${ttl}s`);
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error(`[Cache] SET error for ${key}: ${err.message || 'Unknown error'}`);
  }
}

/**
 * Delete a key from cache
 */
export async function cacheDelete(key: string): Promise<void> {
  try {
    await client.del(key);
    logger.debug(`[Cache] DEL ${key}`);
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error(`[Cache] DEL error for ${key}: ${err.message || 'Unknown error'}`);
  }
}

/**
 * Delete multiple keys from cache
 */
export async function cacheDeleteMany(keys: string[]): Promise<void> {
  try {
    if (keys.length > 0) {
      await client.del(keys as string[]);
      logger.debug(`[Cache] DEL ${keys.length} keys`);
    }
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error(`[Cache] DEL error for multiple keys: ${err.message || 'Unknown error'}`);
  }
}

/**
 * Invalidate all keys matching a pattern
 */
export async function cacheInvalidatePattern(pattern: string): Promise<void> {
  try {
    let cursor: string | undefined = '0';
    const keys: string[] = [];

    do {
      const result = await client.scan(cursor, { MATCH: pattern, COUNT: 1000 });
      keys.push(...result.keys);
      cursor = result.cursor;
    } while (cursor !== '0');

    if (keys.length > 0) {
      await client.del(keys as string[]);
      logger.debug(`[Cache] Invalidated ${keys.length} keys matching ${pattern}`);
    }
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error(`[Cache] Pattern delete error for ${pattern}: ${err.message || 'Unknown error'}`);
  }
}

/**
 * Check if cache is connected
 */
export function isCacheConnected(): boolean {
  return client.isOpen;
}

/**
 * Get cache info (for monitoring)
 */
export async function getCacheInfo(section?: string): Promise<string> {
  try {
    return await client.info(section);
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error(`[Cache] INFO error: ${err.message || 'Unknown error'}`);
    return '';
  }
}

/**
 * Parse INFO response value
 */
export function parseInfoValue(text: string, key: string): string {
  const match = text.match(new RegExp(`^${key}:(.+)$`, 'm'));
  return match ? match[1] : 'N/A';
}
