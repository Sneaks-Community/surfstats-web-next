import 'server-only';
import mysql from 'mysql2/promise';
import logger from '@/lib/logger';

// Track whether the analytics database connection is actually working
let analyticsConnectionHealthy = false;

// Check if analytics database is configured (env vars are set)
const isAnalyticsConfigured = !!(
  process.env.ANALYTICS_MYSQL_HOST ||
  process.env.ANALYTICS_MYSQL_DATABASE ||
  // Fall back to main database config if analytics-specific not set
  (process.env.MYSQL_HOST && process.env.MYSQL_DATABASE)
);

// Create analytics database pool with graceful fallback
const analyticsPool = mysql.createPool({
  host: process.env.ANALYTICS_MYSQL_HOST || process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.ANALYTICS_MYSQL_PORT || process.env.MYSQL_PORT || '3306'),
  user: process.env.ANALYTICS_MYSQL_USER || process.env.MYSQL_USER || 'root',
  password: process.env.ANALYTICS_MYSQL_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.ANALYTICS_MYSQL_DATABASE || 'player_analytics_surf',
  waitForConnections: true,
  connectionLimit: 5, // Smaller pool for secondary database
  queueLimit: 0,
});

// Log pool connection events (debug mode only)
analyticsPool.on('connection', () => {
  logger.debug('[Analytics DB] New connection created in pool');
});

analyticsPool.on('acquire', () => {
  logger.debug('[Analytics DB] Connection acquired from pool');
});

analyticsPool.on('release', () => {
  logger.debug('[Analytics DB] Connection released back to pool');
});

analyticsPool.on('enqueue', () => {
  logger.warn('[Analytics DB] Queue limit reached, waiting for available connection');
});

// Wrapper to handle connection errors gracefully
const originalAnalyticsQuery = analyticsPool.query.bind(analyticsPool) as any;
analyticsPool.query = async (...args: any[]) => {
  const queryPreview = typeof args[0] === 'string'
    ? args[0].substring(0, 100) + (args[0].length > 100 ? '...' : '')
    : 'prepared statement';

  try {
    const startTime = Date.now();
    const result = await originalAnalyticsQuery(...args);
    const duration = Date.now() - startTime;

    // Log slow queries (> 1 second)
    if (duration > 1000) {
      logger.warn(`[Analytics DB] Slow query detected (${duration}ms): ${queryPreview}`);
    } else {
      logger.debug(`[Analytics DB] Query executed in ${duration}ms: ${queryPreview}`);
    }

    // Mark connection as healthy on successful query
    analyticsConnectionHealthy = true;
    return result;
  } catch (error: any) {
    const errorCode = error.code || 'UNKNOWN';
    const errorMessage = error.message || 'Unknown error';

    // Connection-related errors - mark as unhealthy and return empty result
    if (error.code === 'ECONNREFUSED') {
      logger.error(`[Analytics DB] Connection refused - database server unavailable`);
      logger.error(`[Analytics DB] Error details: ${errorMessage}`);
      analyticsConnectionHealthy = false;
      return [[]] as any;
    }

    if (error.code === 'ENOTFOUND') {
      logger.error(`[Analytics DB] Host not found - unable to resolve host`);
      logger.error(`[Analytics DB] Error details: ${errorMessage}`);
      analyticsConnectionHealthy = false;
      return [[]] as any;
    }

    if (error.code === 'ETIMEDOUT' || error.code === 'PROTOCOL_CONNECTION_LOST') {
      logger.error(`[Analytics DB] Connection timeout or lost - database may be overloaded`);
      logger.error(`[Analytics DB] Error details: ${errorMessage}`);
      analyticsConnectionHealthy = false;
      return [[]] as any;
    }

    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      logger.error(`[Analytics DB] Access denied - check database credentials`);
      logger.error(`[Analytics DB] Error details: ${errorMessage}`);
      analyticsConnectionHealthy = false;
      return [[]] as any;
    }

    if (error.code === 'ER_BAD_DB_ERROR') {
      logger.error(`[Analytics DB] Database not found - check ANALYTICS_MYSQL_DATABASE`);
      logger.error(`[Analytics DB] Error details: ${errorMessage}`);
      analyticsConnectionHealthy = false;
      return [[]] as any;
    }

    // Query errors - log and rethrow
    logger.error(`[Analytics DB] Query error (${errorCode}): ${errorMessage}`);
    logger.error(`[Analytics DB] Query: ${queryPreview}`);
    if (args[1]) {
      logger.debug('[Analytics DB] Parameters:', args[1]);
    }
    throw error;
  }
};

// Initialize database connection and pre-warm caches at server startup
async function initializeAnalyticsDatabase() {
  // Skip if not configured
  if (!isAnalyticsConfigured) {
    logger.info('[Analytics DB] Not configured - analytics features disabled');
    return;
  }

  logger.info('[Analytics DB] Initializing database connection...');

  try {
    // Test connection with a simple query
    const connection = await analyticsPool.getConnection();
    await connection.ping();
    connection.release();
    analyticsConnectionHealthy = true;
    logger.info('[Analytics DB] Database connection established successfully');
  } catch (error: any) {
    // Log but don't throw - analytics database is optional
    analyticsConnectionHealthy = false;
    logger.warn(`[Analytics DB] Database connection failed: ${error.message}`);
    logger.warn('[Analytics DB] Analytics features will be disabled');
  }
}

// Initialize on module load
initializeAnalyticsDatabase();

export default analyticsPool;

/**
 * Check if the analytics database is available and healthy
 * Returns true only if configured AND connection is working
 */
export function isAnalyticsAvailable(): boolean {
  return isAnalyticsConfigured && analyticsConnectionHealthy;
}