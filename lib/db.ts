import 'server-only';
import mysql from 'mysql2/promise';
import logger from '@/lib/logger';
import { wrapPoolQuery } from '@/lib/db-query-logger';

// Fail-fast on missing required environment variables
const MYSQL_HOST = process.env.MYSQL_HOST;
const MYSQL_USER = process.env.MYSQL_USER;
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD;
const MYSQL_DATABASE = process.env.MYSQL_DATABASE;

if (!MYSQL_HOST) {
  throw new Error('MYSQL_HOST environment variable is required');
}
if (!MYSQL_USER) {
  throw new Error('MYSQL_USER environment variable is required');
}
if (!MYSQL_PASSWORD) {
  throw new Error('MYSQL_PASSWORD environment variable is required');
}
if (!MYSQL_DATABASE) {
  throw new Error('MYSQL_DATABASE environment variable is required');
}

const pool = mysql.createPool({
  host: MYSQL_HOST,
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 100,
  // Milliseconds before a timeout occurs during the initial connection to the MySQL server
  connectTimeout: 5000,
});

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

// Initialize database connection and pre-warm caches at server startup
async function initializeDatabase() {
  logger.info('[DB] Initializing database connection...');
  
  try {
    // Test connection
    const startTime = Date.now();
    await pool.query('SELECT 1');
    const duration = Date.now() - startTime;
    logger.info(`[DB] Database connection established successfully (${duration}ms)`);
    
    // Pre-warm all caches (stats, servers, map metadata)
    logger.debug('[DB] Pre-warming application caches...');
    const { prewarmCaches } = await import('./cache');
    await prewarmCaches();
    
    logger.info('[DB] Initialization complete');
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
  }
}

// Run initialization only at runtime, not during build
// This prevents connection errors during Docker builds when MySQL isn't available
const isBuildPhase = process.env.npm_lifecycle_event === 'build' ||
                     process.env.NEXT_PHASE === 'build' ||
                     process.env.NEXT_PHASE === 'phase-production-build';

if (!isBuildPhase) {
  if (typeof window === 'undefined') {
    setImmediate(() => {
      initializeDatabase().catch((err) => {
        logger.error('[DB] Deferred initialization failed:', err);
      });
    });
  }
}

export default pool;