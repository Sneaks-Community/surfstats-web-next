/**
 * Timeout utilities
 *
 * Two halves that must be read together:
 * - `withTimeout` is the client-side backstop. It only abandons the promise;
 *   the query keeps running and keeps its pool connection.
 * - `applyStatementTimeout` is the server-side kill. It is what actually
 *   releases the connection, so a slow query cannot pile up copies of itself.
 */

import type { PoolConnection } from 'mysql2';
import type { Pool } from 'mysql2/promise';
import logger from './logger';

/**
 * Wraps a promise with a timeout
 * 
 * @param promise - The promise to wrap
 * @param ms - Timeout in milliseconds
 * @param message - Error message if timeout occurs
 * @returns The result of the promise or throws on timeout
 * 
 * @example
 * const result = await withTimeout(
 *   expensiveOperation(),
 *   30000,
 *   'Operation timed out'
 * );
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message = 'Operation timed out'
): Promise<T> {
  // Create a deferred promise for the timeout
  let timeoutId: NodeJS.Timeout | null = null;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });
  
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    // Cleanup: clear timeout if it hasn't fired yet
    // This prevents memory leaks when the promise resolves before timeout
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (timeoutId != null) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Caps every statement on every connection in a pool, server-side.
 *
 * `withTimeout` cannot cancel a running query: the driver stops waiting, the
 * server keeps working, and the connection stays busy. One slow query then
 * piles up a fresh copy per retry until the pool is exhausted (this happened,
 * see COR-3/DRY-13 in plans/20260810-opus-review.md). The session variable set
 * here makes the server kill the statement instead, which releases the
 * connection.
 *
 * MariaDB spells it `max_statement_time` (seconds); MySQL 5.7+, Percona and
 * Aurora spell it `max_execution_time` (milliseconds, SELECT only), and each
 * rejects the other's name. mysql2 already reads the vendor off the handshake
 * packet, so pick the right name from that and spend exactly one round trip per
 * connection. The other name is still tried if the first is rejected, so a
 * rename inside the driver degrades to two round trips rather than to no cap.
 *
 * Set on the pool's `connection` event, which mysql2 emits before the
 * connection is handed out. Commands are serialized per connection, so the SET
 * lands before the acquirer's first query.
 *
 * The limit is `DB_STATEMENT_TIMEOUT_MS` (default 30000, matching the
 * client-side QUERY_TIMEOUT_MS in the cache modules); 0 disables it.
 *
 * @param pool - The pool to cap
 * @param prefix - Logger prefix, matching the pool's other log lines
 */
export function applyStatementTimeout(pool: Pool, prefix: string): void {
  const parsed = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS ?? '', 10);
  const ms = Number.isNaN(parsed) ? 30000 : parsed;

  if (ms <= 0) {
    logger.warn(`[${prefix}] Server-side statement timeout disabled`);
    return;
  }

  let warned = false;

  const mariaDbSql = `SET SESSION max_statement_time=${ms / 1000}`;
  const mySqlSql = `SET SESSION max_execution_time=${Math.round(ms)}`;

  pool.on('connection', (connection) => {
    // The promise wrapper forwards the callback-style connection, not the
    // promise-wrapped one its typings claim.
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
