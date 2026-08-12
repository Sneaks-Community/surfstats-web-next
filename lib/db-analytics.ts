import 'server-only';
import mysql from 'mysql2/promise';
import logger from '@/lib/logger';
import { wrapPoolQuery } from '@/lib/db-query-logger';
import { getErrorMessage } from './errors';
import { onShutdown } from './shutdown';

// Track whether the analytics database connection is actually working
let analyticsConnectionHealthy = false;

// Analytics is opt-in: it needs one of its own env vars. Falling back to
// MYSQL_HOST/MYSQL_DATABASE made this always true (they are required to boot),
// so the "not configured" branch was dead and the pool always dialled
// player_analytics_surf on the main host. Keep this rule in step with the same
// check in lib/env.ts.
const isAnalyticsConfigured = !!(
  process.env.ANALYTICS_MYSQL_HOST || process.env.ANALYTICS_MYSQL_DATABASE
);

// Create analytics database pool with graceful fallback
const analyticsPool = mysql.createPool({
  host: process.env.ANALYTICS_MYSQL_HOST || process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.ANALYTICS_MYSQL_PORT || process.env.MYSQL_PORT || '3306', 10) || 3306,
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

// Wrap the pool with slow query logging using the shared utility
wrapPoolQuery(analyticsPool, { prefix: 'Analytics DB', slowThresholdMs: 1000 });

// How often to re-check the analytics connection health, in milliseconds.
// Configurable via ANALYTICS_HEALTHCHECK_INTERVAL_MS (clamped to a 10s minimum so
// a typo can't hammer the DB). Set it to 0 (or a negative value) to disable
// periodic re-checks and only probe once at startup.
function resolveHealthCheckIntervalMs(): number {
  const raw = process.env.ANALYTICS_HEALTHCHECK_INTERVAL_MS;
  if (raw === undefined || raw.trim() === '') {
    return 60_000; // default: 1 minute
  }
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return 60_000;
  }
  if (parsed <= 0) {
    return 0; // disabled
  }
  return Math.max(10_000, parsed);
}

const HEALTHCHECK_INTERVAL_MS = resolveHealthCheckIntervalMs();

let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
// Tracks the last state we logged so a steady connection doesn't spam the log —
// we only emit on the first probe and on each subsequent up<->down transition.
let lastLoggedHealthy: boolean | null = null;

// Probe the analytics connection and update the health flag. Never throws -
// analytics is optional, so a failed probe just flips the feature off until it
// recovers on a later probe.
async function checkAnalyticsConnection(): Promise<void> {
  try {
    const connection = await analyticsPool.getConnection();
    await connection.ping();
    connection.release();
    analyticsConnectionHealthy = true;
    if (lastLoggedHealthy !== true) {
      logger.info('[Analytics DB] Database connection is healthy - analytics features enabled');
      lastLoggedHealthy = true;
    }
  } catch (error: unknown) {
    analyticsConnectionHealthy = false;
    if (lastLoggedHealthy !== false) {
      logger.warn(
        `[Analytics DB] Database connection unavailable: ${getErrorMessage(error)} - analytics features disabled until it recovers`
      );
      lastLoggedHealthy = false;
    }
  }
}

// Start the analytics health monitor: one immediate probe at startup, then a
// periodic re-probe on the configured interval. Idempotent - safe to call more
// than once.
function startAnalyticsHealthCheck(): void {
  // Skip entirely if not configured
  if (!isAnalyticsConfigured) {
    logger.info('[Analytics DB] Not configured - analytics features disabled');
    return;
  }

  if (healthCheckTimer) {
    logger.debug('[Analytics DB] Health check already running');
    return;
  }

  logger.info('[Analytics DB] Initializing database connection...');

  // Immediate probe so isAnalyticsAvailable() is accurate right away
  checkAnalyticsConnection(); // eslint-disable-line @typescript-eslint/no-floating-promises

  if (HEALTHCHECK_INTERVAL_MS <= 0) {
    logger.info('[Analytics DB] Periodic health re-check disabled (ANALYTICS_HEALTHCHECK_INTERVAL_MS<=0)');
    return;
  }

  healthCheckTimer = setInterval(() => {
    checkAnalyticsConnection(); // eslint-disable-line @typescript-eslint/no-floating-promises
  }, HEALTHCHECK_INTERVAL_MS);
  logger.info(`[Analytics DB] Periodic health re-check enabled (every ${HEALTHCHECK_INTERVAL_MS}ms)`);
}

// Start monitoring on module load
startAnalyticsHealthCheck();

// Graceful shutdown: stop the health monitor and drain the pool.
onShutdown('analytics-pool', async () => {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
    logger.info('[Analytics DB] Health check stopped');
  }
  await analyticsPool.end();
  logger.info('[Analytics DB] Connection pool closed');
});

export default analyticsPool;

/**
 * Check if the analytics database is available and healthy
 * Returns true only if configured AND connection is working
 */
export function isAnalyticsAvailable(): boolean {
  return isAnalyticsConfigured && analyticsConnectionHealthy;
}
