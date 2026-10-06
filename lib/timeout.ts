// `withTimeout` only abandons the promise; the query keeps running on its connection.
// `applyStatementTimeout` is the server-side kill that frees it.

import type { PoolConnection } from 'mysql2';
import type { Pool } from 'mysql2/promise';
import logger from './logger';
import { getErrorMessage } from './errors';
import { getEnv } from './env';

/** Reject after `ms` if `promise` has not settled. Does not cancel its work. */
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
 * Server-side cap per statement (`DB_STATEMENT_TIMEOUT_MS`, 0 disables), so a query the client
 * gave up on frees its connection. Also backpressure: a held expensive-query slot stalls its queue.
 */
export function applyStatementTimeout(pool: Pool, prefix: string): void {
  const ms = getEnv().DB_STATEMENT_TIMEOUT_MS;
  if (ms === 0) {
    logger.warn(`[${prefix}] Server-side statement timeout disabled`);
    return;
  }

  let warned = false;

  const mariaDbSql = `SET SESSION max_statement_time=${ms / 1000}`;
  const mySqlSql = `SET SESSION max_execution_time=${Math.round(ms)}`;

  // MariaDB: max_statement_time (s); MySQL: max_execution_time (ms, SELECT only).
  // Each rejects the other's name, so try the vendor's first and fall back. Commands
  // serialize per connection, so the SET lands before the acquirer's first query.
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
        logger.warn(
          `[${prefix}] Could not set a server-side statement timeout, queries are uncapped: ${getErrorMessage(error)}`
        );
      });
  });
}
