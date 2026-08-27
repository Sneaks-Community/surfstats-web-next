/**
 * `withTimeout` only abandons the promise; the query keeps running on its
 * connection. `applyStatementTimeout` is the server-side kill that frees it.
 */

import type { PoolConnection } from 'mysql2';
import type { Pool } from 'mysql2/promise';
import logger from './logger';

/**
 * Reject after `ms` if `promise` has not settled. Does not cancel its work.
 *
 * @param promise - The promise to wrap
 * @param ms - Timeout in milliseconds
 * @param message - Error message if the timeout fires
 * @returns The promise's result, or throws on timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message = 'Operation timed out'
): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });
  
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (timeoutId != null) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Cap every statement server-side, so a query the client gave up on stops
 * holding its pool connection.
 *
 * MariaDB spells it `max_statement_time` (seconds), MySQL/Percona/Aurora
 * `max_execution_time` (ms, SELECT only), and each rejects the other's name;
 * mysql2's handshake vendor flag picks which to try first, the other is the
 * fallback. Per-connection command serialization gets the SET in before the
 * acquirer's first query. `DB_STATEMENT_TIMEOUT_MS` (default 8000) is the
 * limit; 0 disables it. The cap doubles as backpressure: an expensive-query
 * slot held for 30s stalls every caller queued behind it.
 *
 * @param pool - The pool to cap
 * @param prefix - Logger prefix, matching the pool's other log lines
 */
export function applyStatementTimeout(pool: Pool, prefix: string): void {
  const parsed = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS ?? '', 10);
  const ms = Number.isNaN(parsed) ? 8000 : parsed;

  if (ms <= 0) {
    logger.warn(`[${prefix}] Server-side statement timeout disabled`);
    return;
  }

  let warned = false;

  const mariaDbSql = `SET SESSION max_statement_time=${ms / 1000}`;
  const mySqlSql = `SET SESSION max_execution_time=${Math.round(ms)}`;

  pool.on('connection', (connection) => {
    // The event forwards the callback-style connection, not the promise-wrapped
    // one its typings claim.
    const core = connection as unknown as PoolConnection & { _isMariaDB?: boolean };
    const conn = core.promise();
    const [first, second] = core._isMariaDB ? [mariaDbSql, mySqlSql] : [mySqlSql, mariaDbSql];

    conn
      .query(first)
      .catch(() => conn.query(second))
      .catch((error: unknown) => {
        if (warned) return;
        warned = true;
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          `[${prefix}] Could not set a server-side statement timeout, queries are uncapped: ${message}`
        );
      });
  });
}
