import 'server-only';
import mysql from 'mysql2/promise';
import logger from '@/lib/logger';
import { wrapPoolQuery } from '@/lib/db-query-logger';
import { getEnv, isBuildPhase, validateEnv } from '@/lib/env';
import { onShutdown } from '@/lib/shutdown';
import { applyStatementTimeout } from '@/lib/timeout';
import { getErrorCode, getErrorMessage } from '@/lib/errors';

const env = getEnv();

// Create pool - uses env vars at runtime, fallback defaults at build time
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: env.MYSQL_PORT,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'cksurf',
  waitForConnections: true,
  connectionLimit: env.DB_CONNECTION_LIMIT,
  queueLimit: env.DB_QUEUE_LIMIT,
  // Milliseconds before a timeout occurs during the initial connection to the MySQL server
  connectTimeout: env.DB_CONNECT_TIMEOUT_MS,
  // DECIMAL runtimes and SUM()/AVG() results arrive as numbers, as the row types
  // claim, rather than as strings that only arithmetic happened to coerce.
  decimalNumbers: true,
});

// Validate env vars at module load time (only at runtime, not build)
validateEnv();

// Log pool connection events (debug mode only)
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

// Wrap the pool with slow query logging
wrapPoolQuery(pool, { prefix: 'DB' });

// Cap statements server-side so a timed-out query releases its connection
applyStatementTimeout(pool, 'DB');

/**
 * Probe the connection. Called once from `lib/startup.ts`, never at module scope
 * (a lib module can be evaluated in several bundles). Warming is not done here:
 * every cache is owned by a background refresher whose first run is its warm.
 *
 * @returns whether the probe succeeded; gates the map-graph precache.
 */
export async function initializeDatabase(): Promise<boolean> {
  logger.info('[DB] Initializing database connection...');

  try {
    // Test connection
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
    
    // Log helpful hints based on error type
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

// Graceful shutdown: drain the pool so open connections close cleanly.
if (!isBuildPhase && typeof window === 'undefined') {
  onShutdown('db-pool', async () => {
    await pool.end();
    logger.info('[DB] Connection pool closed');
  });
}

export default pool;
