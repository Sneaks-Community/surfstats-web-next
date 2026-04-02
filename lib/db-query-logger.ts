import 'server-only';
import mysql from 'mysql2/promise';
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
  const originalQuery = pool.query.bind(pool) as any;

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
    } catch (error: any) {
      const errorCode = error.code || 'UNKNOWN';
      const errorMessage = error.message || 'Unknown error';

      // Connection-related errors - handle gracefully
      if (error.code === 'ECONNREFUSED') {
        logger.error(`[${prefix}] Connection refused - database server unavailable`);
        logger.error(`[${prefix}] Error details: ${errorMessage}`);
        return [[]] as any;
      }

      if (error.code === 'ENOTFOUND') {
        logger.error(`[${prefix}] Host not found - unable to resolve host`);
        logger.error(`[${prefix}] Error details: ${errorMessage}`);
        return [[]] as any;
      }

      if (error.code === 'ETIMEDOUT' || error.code === 'PROTOCOL_CONNECTION_LOST') {
        logger.error(`[${prefix}] Connection timeout or lost - database may be overloaded`);
        logger.error(`[${prefix}] Error details: ${errorMessage}`);
        return [[]] as any;
      }

      if (error.code === 'ER_ACCESS_DENIED_ERROR') {
        logger.error(`[${prefix}] Access denied - check database credentials`);
        logger.error(`[${prefix}] Error details: ${errorMessage}`);
        return [[]] as any;
      }

      if (error.code === 'ER_BAD_DB_ERROR') {
        logger.error(`[${prefix}] Database not found - check database name`);
        logger.error(`[${prefix}] Error details: ${errorMessage}`);
        return [[]] as any;
      }

      // Query errors - log and rethrow
      logger.error(`[${prefix}] Query error (${errorCode}): ${errorMessage}`);
      logger.error(`[${prefix}] Query: ${queryPreview}`);
      throw error;
    }
  };
}
