import 'server-only';
import mysql from 'mysql2/promise';
import logger from '@/lib/logger';
import { wrapPoolQuery } from '@/lib/db-query-logger';
import { getErrorMessage } from './errors';
import { onShutdown } from './shutdown';
import { applyStatementTimeout } from './timeout';
import { createBackgroundRefresh } from './background-refresh';
import { getEnv } from './env';

// On globalThis: only one module evaluation wins the probe slot (lib/background-refresh.ts);
// the others read its result instead of a flag that would stay false forever.
const globalForAnalytics = globalThis as unknown as {
  __surfstatsAnalyticsHealthy?: boolean;
};

// Opt-in via its own env vars: falling back to the always-set MYSQL_* would always dial
// player_analytics_surf on the main host. Keep this rule in step with lib/env.ts.
const isAnalyticsConfigured = !!(
  process.env.ANALYTICS_MYSQL_HOST || process.env.ANALYTICS_MYSQL_DATABASE
);

const env = getEnv();

const analyticsPool = mysql.createPool({
  host: process.env.ANALYTICS_MYSQL_HOST || process.env.MYSQL_HOST || 'localhost',
  port: env.ANALYTICS_MYSQL_PORT ?? env.MYSQL_PORT,
  user: process.env.ANALYTICS_MYSQL_USER || process.env.MYSQL_USER || 'root',
  password: process.env.ANALYTICS_MYSQL_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.ANALYTICS_MYSQL_DATABASE || 'player_analytics_surf',
  waitForConnections: true,
  connectionLimit: 5, // secondary DB, so a smaller pool
  queueLimit: 100,
  // Same as the main pool: SUM(duration) is a DECIMAL.
  decimalNumbers: true,
});

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
  logger.debug('[Analytics DB] All connections busy, request queued');
});

wrapPoolQuery(analyticsPool, { prefix: 'Analytics DB', slowThresholdMs: 1000 });

applyStatementTimeout(analyticsPool, 'Analytics DB');

const HEALTHCHECK_INTERVAL_MS = env.ANALYTICS_HEALTHCHECK_INTERVAL_MS;

// Log only the first probe and up/down transitions.
let lastLoggedHealthy: boolean | null = null;

// Never throws: a failed probe turns analytics off until a later probe succeeds.
async function checkAnalyticsConnection(): Promise<void> {
  try {
    const connection = await analyticsPool.getConnection();
    await connection.ping();
    connection.release();
    globalForAnalytics.__surfstatsAnalyticsHealthy = true;
    if (lastLoggedHealthy !== true) {
      logger.info('[Analytics DB] Database connection is healthy - analytics features enabled');
      lastLoggedHealthy = true;
    }
  } catch (error: unknown) {
    globalForAnalytics.__surfstatsAnalyticsHealthy = false;
    if (lastLoggedHealthy !== false) {
      logger.warn(
        `[Analytics DB] Database connection unavailable: ${getErrorMessage(error)} - analytics features disabled until it recovers`
      );
      lastLoggedHealthy = false;
    }
  }
}

const analyticsHealthCheck = createBackgroundRefresh({
  name: 'Analytics DB',
  intervalMs: HEALTHCHECK_INTERVAL_MS,
  task: checkAnalyticsConnection,
  startupDetail: `health probe every ${HEALTHCHECK_INTERVAL_MS}ms`,
});

/**
 * Probes now so {@link isAnalyticsAvailable} is accurate at once, then every
 * ANALYTICS_HEALTHCHECK_INTERVAL_MS (`<=0` disables re-probes). No-op when unconfigured.
 */
export function startAnalyticsHealthCheck(): void {
  if (!isAnalyticsConfigured) {
    logger.info('[Analytics DB] Not configured - analytics features disabled');
    return;
  }

  logger.info('[Analytics DB] Initializing database connection...');
  analyticsHealthCheck.start();
}

// Only the pool needs draining; background-refresh clears the probe timer.
onShutdown('analytics-pool', async () => {
  await analyticsPool.end();
  logger.info('[Analytics DB] Connection pool closed');
});

export default analyticsPool;

/** True only when configured and the last probe succeeded. */
export function isAnalyticsAvailable(): boolean {
  return isAnalyticsConfigured && globalForAnalytics.__surfstatsAnalyticsHealthy === true;
}
