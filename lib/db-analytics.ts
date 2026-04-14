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
  queueLimit: 100,
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

// Wrap the pool with slow query logging and health tracking
const originalAnalyticsQuery = analyticsPool.query.bind(analyticsPool);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
analyticsPool.query = async function (sql: any, values?: any[]) {
  const queryPreview = typeof sql === 'string'
    ? sql.substring(0, 300) + (sql.length > 300 ? '...' : '')
    : 'prepared statement';

  try {
    const startTime = Date.now();
    const result = await originalAnalyticsQuery(sql, values);
    const duration = Date.now() - startTime;

    // Log all queries at debug level
    logger.debug(`[Analytics DB] Query executed in ${duration}ms: ${queryPreview}`);

    // Log slow queries as warning
    if (duration > 1000) {
      logger.warn(`[Analytics DB] Slow query detected (${duration}ms): ${queryPreview}`);
    }

    analyticsConnectionHealthy = true;
    return result;
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    const errorCode = err.code || 'UNKNOWN';
    const errorMessage = err.message || 'Unknown error';

    // Log all errors with context
    logger.error(`[Analytics DB] Database error (${errorCode}): ${errorMessage}`);
    logger.error(`[Analytics DB] Query: ${queryPreview}`);

    analyticsConnectionHealthy = false;
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
  } catch (error: unknown) {
    // Log but don't throw - analytics database is optional
    analyticsConnectionHealthy = false;
    logger.warn(`[Analytics DB] Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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