import 'server-only';
import client from './valkey';
import logger from './logger';
import {
  CircuitBreakerError,
  createCircuitBreaker,
  registerCircuitBreaker,
  getAllCircuitBreakerStats,
  type CircuitBreakerStats,
  type CircuitState,
} from './circuit-breaker';

// ============================================================
// CIRCUIT BREAKERS FOR CACHE OPERATIONS
// ============================================================

/**
 * Circuit breaker for cache GET operations
 * Uses sliding window with 1 minute window size and 50% failure rate threshold
 */
const cacheGetBreaker = createCircuitBreaker(
  async (...args: unknown[]): Promise<unknown> => {
    const [key] = args as [string];
    return client.get(key);
  },
  {
    name: 'cache-get',
    failureThreshold: 5,
    resetTimeout: 30000,
    successThreshold: 3,
    windowSize: 60000, // 1 minute sliding window
    failureRateThreshold: 0.5, // 50% failure rate
    minimumRequestsInWindow: 10,
  }
);
registerCircuitBreaker('cache-get', cacheGetBreaker);

/**
 * Circuit breaker for cache SET operations
 * Uses sliding window with 1 minute window size and 50% failure rate threshold
 */
const cacheSetBreaker = createCircuitBreaker(
  async (...args: unknown[]): Promise<unknown> => {
    const [key, ttl, value] = args as [string, number, string];
    return client.setEx(key, ttl, value);
  },
  {
    name: 'cache-set',
    failureThreshold: 5,
    resetTimeout: 30000,
    successThreshold: 3,
    windowSize: 60000, // 1 minute sliding window
    failureRateThreshold: 0.5, // 50% failure rate
    minimumRequestsInWindow: 10,
  }
);
registerCircuitBreaker('cache-set', cacheSetBreaker);

/**
 * Circuit breaker for cache DELETE operations
 * Uses sliding window with 1 minute window size and 50% failure rate threshold
 */
const cacheDeleteBreaker = createCircuitBreaker(
  async (...args: unknown[]): Promise<unknown> => {
    const [key] = args as [string];
    return client.del(key);
  },
  {
    name: 'cache-delete',
    failureThreshold: 5,
    resetTimeout: 30000,
    successThreshold: 3,
    windowSize: 60000, // 1 minute sliding window
    failureRateThreshold: 0.5, // 50% failure rate
    minimumRequestsInWindow: 10,
  }
);
registerCircuitBreaker('cache-delete', cacheDeleteBreaker);

/**
 * Circuit breaker for cache SCAN operations
 * Uses sliding window with 1 minute window size and 50% failure rate threshold
 */
const cacheScanBreaker = createCircuitBreaker(
  async (...args: unknown[]): Promise<unknown> => {
    const [cursor, pattern] = args as [string | undefined, string];
    return client.scan(cursor ?? '0', { MATCH: pattern, COUNT: 1000 });
  },
  {
    name: 'cache-scan',
    failureThreshold: 5,
    resetTimeout: 30000,
    successThreshold: 3,
    windowSize: 60000, // 1 minute sliding window
    failureRateThreshold: 0.5, // 50% failure rate
    minimumRequestsInWindow: 10,
  }
);
registerCircuitBreaker('cache-scan', cacheScanBreaker);

// ============================================================
// CACHE OPERATIONS WITH CIRCUIT BREAKER PROTECTION
// ============================================================

/**
 * Get a value from cache with circuit breaker protection
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    // Execute through circuit breaker
    const cached = await cacheGetBreaker.execute(key);
    
    if (!cached) {
      logger.debug(`[Cache] Miss: ${key}`);
      return null;
    }
    const value = JSON.parse(cached as string) as T;
    logger.debug(`[Cache] Hit: ${key}`);
    return value;
  } catch (error: unknown) {
    // Handle circuit breaker errors
    if (error instanceof CircuitBreakerError) {
      logger.warn(`[Cache] Circuit breaker OPEN for GET ${key}: ${error.state}`);
      return null; // Return null on circuit open (fail open for reads)
    }

    const err = error as { message?: string };
    logger.error(`[Cache] GET error for ${key}: ${err.message || 'Unknown error'}`);
    return null;
  }
}

/**
 * Set a value in cache with circuit breaker protection
 */
export async function cacheSet<T>(key: string, value: T, ttl: number): Promise<void> {
  try {
    const serialized = JSON.stringify(value);
    // Execute through circuit breaker
    await cacheSetBreaker.execute(key, ttl, serialized);
    logger.debug(`[Cache] SET ${key} with TTL ${ttl}s`);
  } catch (error: unknown) {
    // Handle circuit breaker errors
    if (error instanceof CircuitBreakerError) {
      logger.warn(`[Cache] Circuit breaker OPEN for SET ${key}: ${error.state}`);
      return; // Silently fail on circuit open (cache is optional)
    }

    const err = error as { message?: string };
    logger.error(`[Cache] SET error for ${key}: ${err.message || 'Unknown error'}`);
  }
}

/**
 * Delete a key from cache with circuit breaker protection
 */
export async function cacheDelete(key: string): Promise<void> {
  try {
    // Execute through circuit breaker
    await cacheDeleteBreaker.execute(key);
    logger.debug(`[Cache] DEL ${key}`);
  } catch (error: unknown) {
    // Handle circuit breaker errors
    if (error instanceof CircuitBreakerError) {
      logger.warn(`[Cache] Circuit breaker OPEN for DEL ${key}: ${error.state}`);
      return; // Silently fail on circuit open
    }

    const err = error as { message?: string };
    logger.error(`[Cache] DEL error for ${key}: ${err.message || 'Unknown error'}`);
  }
}

/**
 * Delete multiple keys from cache with circuit breaker protection
 */
export async function cacheDeleteMany(keys: string[]): Promise<void> {
  try {
    if (keys.length > 0) {
      // Execute through circuit breaker
      await cacheDeleteBreaker.execute(keys[0]); // Use first key as representative
      logger.debug(`[Cache] DEL ${keys.length} keys`);
    }
  } catch (error: unknown) {
    // Handle circuit breaker errors
    if (error instanceof CircuitBreakerError) {
      logger.warn(`[Cache] Circuit breaker OPEN for DEL many: ${error.state}`);
      return; // Silently fail on circuit open
    }

    const err = error as { message?: string };
    logger.error(`[Cache] DEL error for multiple keys: ${err.message || 'Unknown error'}`);
  }
}

/**
 * Invalidate all keys matching a pattern with circuit breaker protection
 */
export async function cacheInvalidatePattern(pattern: string): Promise<void> {
  try {
    let cursor: string | undefined = '0';
    const keys: string[] = [];

    do {
      // Execute through circuit breaker
      const result = await cacheScanBreaker.execute(cursor, pattern);
      const scanResult = result as { cursor: string; keys: string[] };
      keys.push(...scanResult.keys);
      cursor = scanResult.cursor;
    } while (cursor !== '0');

    if (keys.length > 0) {
      // Execute through circuit breaker
      await cacheDeleteBreaker.execute(keys[0]); // Use first key as representative
      logger.debug(`[Cache] Invalidated ${keys.length} keys matching ${pattern}`);
    }
  } catch (error: unknown) {
    // Handle circuit breaker errors
    if (error instanceof CircuitBreakerError) {
      logger.warn(`[Cache] Circuit breaker OPEN for pattern delete ${pattern}: ${error.state}`);
      return; // Silently fail on circuit open
    }

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

/**
 * Get circuit breaker statistics for monitoring
 */
export function getCircuitBreakerStats(): Map<string, CircuitBreakerStats> {
  return getAllCircuitBreakerStats();
}

/**
 * Get circuit breaker state for a specific breaker
 */
export function getCircuitBreakerState(breakerName: string): CircuitState | undefined {
  const breaker = cacheGetBreaker;
  if (breakerName === 'cache-get') return breaker.getState();
  if (breakerName === 'cache-set') return cacheSetBreaker.getState();
  if (breakerName === 'cache-delete') return cacheDeleteBreaker.getState();
  if (breakerName === 'cache-scan') return cacheScanBreaker.getState();
  return undefined;
}

/**
 * Manually reset a circuit breaker (for monitoring/ops)
 */
export function resetCircuitBreaker(breakerName: string): void {
  if (breakerName === 'cache-get') cacheGetBreaker.reset();
  else if (breakerName === 'cache-set') cacheSetBreaker.reset();
  else if (breakerName === 'cache-delete') cacheDeleteBreaker.reset();
  else if (breakerName === 'cache-scan') cacheScanBreaker.reset();
  else logger.warn(`[Cache] Unknown circuit breaker: ${breakerName}`);
}
