import 'server-only';
import type mysql from 'mysql2/promise';
import logger from './logger';

export interface DbQueryLoggerOptions {
  /** Logger prefix for identifying the database source */
  prefix: string;
  /** Slow query threshold in milliseconds (default: 1000) */
  slowThresholdMs?: number;
}

/**
 * Wraps a MySQL pool's query method with slow query logging.
 * 
 * Logs all queries at debug level.
 * Logs slow queries (>threshold) at both debug AND warn level.
 * Does NOT include query parameters in logs.
 * 
 * @param pool - The MySQL pool to wrap
 * @param options - Configuration options
 * 
 * @example
 * wrapPoolQuery(pool, { prefix: 'DB' });
 * wrapPoolQuery(analyticsPool, { prefix: 'Analytics DB' });
 */
export function wrapPoolQuery(
  pool: mysql.Pool,
  options: DbQueryLoggerOptions
): void {
  const { prefix, slowThresholdMs = 1000 } = options;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalQuery = pool.query.bind(pool) as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool.query = async (...args: any[]) => {
    const queryPreview = typeof args[0] === 'string'
      ? args[0].substring(0, 300) + (args[0].length > 300 ? '...' : '')
      : 'prepared statement';

    try {
      const startTime = Date.now();
      const result = await originalQuery(...args);
      const duration = Date.now() - startTime;

      // Log all queries at debug level
      logger.debug(`[${prefix}] Query executed in ${duration}ms: ${queryPreview}`);

      // Log slow queries as warning
      if (duration > slowThresholdMs) {
        logger.warn(`[${prefix}] Slow query detected (${duration}ms): ${queryPreview}`);
      }

      return result;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      const errorCode = error.code || 'UNKNOWN';
      const errorMessage = error.message || 'Unknown error';

      // Log all errors with context
      logger.error(`[${prefix}] Database error (${errorCode}): ${errorMessage}`);
      logger.error(`[${prefix}] Query: ${queryPreview}`);

      // Rethrow all errors to allow callers to handle or propagate them
      // Returning empty arrays silently masks failures and causes incorrect cached data
      throw error;
    }
  };
}
