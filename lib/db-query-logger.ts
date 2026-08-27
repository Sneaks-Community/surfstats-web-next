import 'server-only';
import type mysql from 'mysql2/promise';
import logger from './logger';

export interface DbQueryLoggerOptions {
  /** Logger prefix for identifying the database source */
  prefix: string;
  /** Slow query threshold in milliseconds (default: 1000) */
  slowThresholdMs?: number;
}

/** Marker so a re-evaluated module can't nest a second wrapper on one pool. */
const WRAPPED = Symbol.for('surfstats.queryLoggerWrapped');

/**
 * Wraps a MySQL pool's `query` and `execute` with slow query logging.
 *
 * Logs all queries at debug level.
 * Logs slow queries (>threshold) at both debug AND warn level.
 * Does NOT include query parameters in logs.
 *
 * Idempotent: re-wrapping a pool is a no-op (see WRAPPED), so a re-evaluated
 * module can't make every query log twice.
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

  const marked = pool as mysql.Pool & { [WRAPPED]?: boolean };
  if (marked[WRAPPED]) {
    logger.debug(`[${prefix}] Query logging already installed`);
    return;
  }
  marked[WRAPPED] = true;

  // `execute` is a separate mysql2 code path; wrapping only `query` would lose
  // logging for prepared-statement call sites.
  for (const method of ['query', 'execute'] as const) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const original = pool[method].bind(pool) as any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pool as any)[method] = async (...args: any[]) => {
      const queryPreview = typeof args[0] === 'string'
        ? args[0].substring(0, 600) + (args[0].length > 600 ? '...' : '')
        : 'prepared statement';

      try {
        const startTime = Date.now();
        const result = await original(...args);
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

        if (errorMessage === 'Queue limit reached.') {
          logger.error(
            `[${prefix}] Connection queue full, request rejected before reaching MySQL; raise DB_CONNECTION_LIMIT/DB_QUEUE_LIMIT or shed load earlier`
          );
        } else {
          logger.error(`[${prefix}] Database error (${errorCode}): ${errorMessage}`);
        }
        logger.error(`[${prefix}] Query: ${queryPreview}`);

        // Rethrow all errors to allow callers to handle or propagate them
        // Returning empty arrays silently masks failures and causes incorrect cached data
        throw error;
      }
    };
  }
}
