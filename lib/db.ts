import 'server-only';
import mysql from 'mysql2/promise';
import logger from '@/lib/logger';

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'cksurf',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
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

// Wrapper to handle connection errors gracefully with detailed logging
const originalQuery = pool.query.bind(pool) as any;
pool.query = async (...args: any[]) => {
  const queryPreview = typeof args[0] === 'string' 
    ? args[0].substring(0, 100) + (args[0].length > 100 ? '...' : '')
    : 'prepared statement';
  
  try {
    const startTime = Date.now();
    const result = await originalQuery(...args);
    const duration = Date.now() - startTime;
    
    // Log slow queries (> 1 second)
    if (duration > 1000) {
      logger.warn(`[DB] Slow query detected (${duration}ms): ${queryPreview}`);
    } else {
      logger.debug(`[DB] Query executed in ${duration}ms: ${queryPreview}`);
    }
    
    return result;
  } catch (error: any) {
    const errorCode = error.code || 'UNKNOWN';
    const errorMessage = error.message || 'Unknown error';
    
    // Connection-related errors
    if (error.code === 'ECONNREFUSED') {
      logger.error(`[DB] Connection refused - database server unavailable at ${process.env.MYSQL_HOST || 'localhost'}`);
      logger.error(`[DB] Error details: ${errorMessage}`);
      return [[], []] as any;
    }
    
    if (error.code === 'ENOTFOUND') {
      logger.error(`[DB] Host not found - unable to resolve ${process.env.MYSQL_HOST || 'localhost'}`);
      logger.error(`[DB] Error details: ${errorMessage}`);
      return [[], []] as any;
    }
    
    if (error.code === 'ETIMEDOUT' || error.code === 'PROTOCOL_CONNECTION_LOST') {
      logger.error(`[DB] Connection timeout or lost - database may be overloaded`);
      logger.error(`[DB] Error details: ${errorMessage}`);
      return [[], []] as any;
    }
    
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      logger.error(`[DB] Access denied - check MYSQL_USER and MYSQL_PASSWORD credentials`);
      logger.error(`[DB] Error details: ${errorMessage}`);
      return [[], []] as any;
    }
    
    if (error.code === 'ER_BAD_DB_ERROR') {
      logger.error(`[DB] Database not found - check MYSQL_DATABASE: ${process.env.MYSQL_DATABASE || 'cksurf'}`);
      logger.error(`[DB] Error details: ${errorMessage}`);
      return [[], []] as any;
    }
    
    // Query errors - log and rethrow
    logger.error(`[DB] Query error (${errorCode}): ${errorMessage}`);
    logger.error(`[DB] Query: ${queryPreview}`);
    if (args[1]) {
      logger.debug('[DB] Parameters:', args[1]);
    }
    throw error;
  }
};

// Initialize database connection and pre-warm caches at server startup
async function initializeDatabase() {
  logger.info('[DB] Initializing database connection...');
  
  try {
    // Test connection
    const startTime = Date.now();
    await pool.query('SELECT 1');
    const duration = Date.now() - startTime;
    logger.info(`[DB] Database connection established successfully (${duration}ms)`);
    
    // Pre-fetch stats to warm the cache
    logger.debug('[DB] Pre-fetching stats table...');
    const statsStart = Date.now();
    await pool.query('SELECT `key`, `value` FROM ck_stats');
    logger.debug(`[DB] Stats pre-fetched successfully (${Date.now() - statsStart}ms)`);
    
    // Pre-warm all caches (stats, servers)
    logger.debug('[DB] Pre-warming application caches...');
    const { prewarmCaches } = await import('./cache');
    await prewarmCaches();
    logger.info('[DB] Initialization complete');
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