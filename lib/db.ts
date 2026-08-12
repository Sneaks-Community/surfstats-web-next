import 'server-only';
import mysql from 'mysql2/promise';
import logger from '@/lib/logger';
import { wrapPoolQuery } from '@/lib/db-query-logger';
import { validateEnv } from '@/lib/env';
import { onShutdown } from '@/lib/shutdown';
import { applyStatementTimeout } from '@/lib/timeout';

// Check if in build phase - skip validation during build
const isBuildPhase = process.env.npm_lifecycle_event === 'build' ||
                     process.env.NEXT_PHASE === 'build' ||
                     process.env.NEXT_PHASE === 'phase-production-build';

// queueLimit accepts 0 (mysql2's "unlimited"), so a plain `|| default` won't do —
// only fall back when the var is unset/non-numeric.
const parsedQueueLimit = parseInt(process.env.DB_QUEUE_LIMIT ?? '', 10);
const queueLimit = Number.isNaN(parsedQueueLimit) ? 100 : parsedQueueLimit;

// Create pool - uses env vars at runtime, fallback defaults at build time
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306', 10) || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'cksurf',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '20', 10) || 20,
  queueLimit,
  // Milliseconds before a timeout occurs during the initial connection to the MySQL server
  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT_MS || '5000', 10) || 5000,
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
  logger.warn('[DB] Queue limit reached, waiting for available connection');
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    const errorCode = error.code || 'UNKNOWN';
    const errorMessage = error.message || 'Unknown error';
    logger.error(`[DB] Initialization failed (${errorCode}): ${errorMessage}`);
    logger.error('[DB] Application may not function correctly without database connection');
    
    // Log helpful hints based on error type
    if (error.code === 'ECONNREFUSED') {
      logger.error('[DB] Hint: Ensure MySQL server is running and accessible');
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      logger.error('[DB] Hint: Check database credentials in environment variables');
    } else if (error.code === 'ER_BAD_DB_ERROR') {
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
