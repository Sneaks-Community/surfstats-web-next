import 'server-only';
import type mysql from 'mysql2/promise';
import logger from './logger';
import { withTimeout } from './timeout';
import { getEnv } from './env';
import { getErrorCode, getErrorMessage } from './errors';

export interface DbQueryLoggerOptions {
  /** Log prefix naming the database, e.g. 'DB'. */
  prefix: string;
  /** Default 1000. */
  slowThresholdMs?: number;
}

/** Marker so a re-evaluated module can't nest a second wrapper on one pool. */
const WRAPPED = Symbol.for('surfstats.queryLoggerWrapped');

/**
 * Wraps `query` and `execute`: every query logs at debug, slow ones also at warn, and each gets
 * a client deadline. Idempotent (see WRAPPED). Query parameters are never logged.
 */
export function wrapPoolQuery(
  pool: mysql.Pool,
  options: DbQueryLoggerOptions
): void {
  const { prefix, slowThresholdMs = 1000 } = options;
  // The server kills a statement at its timeout, so one still pending 2s later is
  // lost on the wire. Uncapped statements still get a 30s client backstop.
  const timeoutMs = getEnv().DB_STATEMENT_TIMEOUT_MS;
  const deadlineMs = timeoutMs > 0 ? timeoutMs + 2000 : 30_000;

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
        const result = await withTimeout(original(...args), deadlineMs, `Query exceeded its ${deadlineMs}ms deadline`);
        const duration = Date.now() - startTime;

        logger.debug(`[${prefix}] Query executed in ${duration}ms: ${queryPreview}`);

        if (duration > slowThresholdMs) {
          logger.warn(`[${prefix}] Slow query detected (${duration}ms): ${queryPreview}`);
        }

        return result;
      } catch (error: unknown) {
        const errorCode = getErrorCode(error);
        const errorMessage = getErrorMessage(error);

        if (errorMessage === 'Queue limit reached.') {
          logger.error(
            `[${prefix}] Connection queue full, request rejected before reaching MySQL; raise DB_CONNECTION_LIMIT/DB_QUEUE_LIMIT or shed load earlier`
          );
        } else {
          logger.error(`[${prefix}] Database error (${errorCode}): ${errorMessage}`);
        }
        logger.error(`[${prefix}] Query: ${queryPreview}`);

        // Rethrow: returning [] would mask the failure and get cached as real data.
        throw error;
      }
    };
  }
}
