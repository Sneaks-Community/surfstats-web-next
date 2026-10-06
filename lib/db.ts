import 'server-only';
import mysql from 'mysql2/promise';
import logger from '@/lib/logger';
import { wrapPoolQuery } from '@/lib/db-query-logger';
import { getEnv, isBuildPhase, validateEnv } from '@/lib/env';
import { onShutdown } from '@/lib/shutdown';
import { applyStatementTimeout } from '@/lib/timeout';
import { getErrorCode, getErrorMessage } from '@/lib/errors';

const env = getEnv();

// Fallback defaults only matter at build time.
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: env.MYSQL_PORT,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'cksurf',
  waitForConnections: true,
  connectionLimit: env.DB_CONNECTION_LIMIT,
  queueLimit: env.DB_QUEUE_LIMIT,
  connectTimeout: env.DB_CONNECT_TIMEOUT_MS,
  // DECIMAL and SUM()/AVG() otherwise arrive as strings despite the row types.
  decimalNumbers: true,
});

// No-op during build.
validateEnv();

pool.on('connection', () => {
  logger.debug('[DB] New connection created in pool');
});

pool.on('acquire', () => {
  logger.debug('[DB] Connection acquired from pool');
});

pool.on('release', () => {
  logger.debug('[DB] Connection released back to pool');
});

pool.on('enqueue', () => {
  logger.debug('[DB] All connections busy, request queued');
});

wrapPoolQuery(pool, { prefix: 'DB' });

applyStatementTimeout(pool, 'DB');

/**
 * Probes the connection; the result gates map-graph precache. Called once from `lib/startup.ts`,
 * never at module scope (a module can load in several bundles). Refreshers do all warming.
 */
export async function initializeDatabase(): Promise<boolean> {
  logger.info('[DB] Initializing database connection...');

  try {
    const startTime = Date.now();
    await pool.query('SELECT 1');
    const duration = Date.now() - startTime;
    logger.info(`[DB] Database connection established successfully (${duration}ms)`);
    logger.info('[DB] Initialization complete');
    return true;
  } catch (error: unknown) {
    const errorCode = getErrorCode(error);
    logger.error(`[DB] Initialization failed (${errorCode}): ${getErrorMessage(error)}`);
    logger.error('[DB] Application may not function correctly without database connection');
    
    if (errorCode === 'ECONNREFUSED') {
      logger.error('[DB] Hint: Ensure MySQL server is running and accessible');
    } else if (errorCode === 'ER_ACCESS_DENIED_ERROR') {
      logger.error('[DB] Hint: Check database credentials in environment variables');
    } else if (errorCode === 'ER_BAD_DB_ERROR') {
      logger.error('[DB] Hint: Verify the database name and ensure it exists');
    }
    return false;
  }
}

if (!isBuildPhase && typeof window === 'undefined') {
  onShutdown('db-pool', async () => {
    await pool.end();
    logger.info('[DB] Connection pool closed');
  });
}

export default pool;
