import 'server-only';
import { z } from 'zod';
import logger from './logger';

/**
 * Centralized, boot-time environment validation.
 *
 * Previously env handling was scattered: the MySQL vars failed fast in db.ts,
 * while STEAM_API_KEY, SERVERS_JSON and the analytics DB vars failed silently
 * at request time. This module is the single place that:
 *   - fails fast (throws) on missing/invalid REQUIRED vars, and
 *   - logs clear warnings for optional-but-unset feature flags.
 *
 * Call `validateEnv()` once at server startup.
 */

// Validation is skipped during `next build` (env not present, no server running).
const isBuildPhase =
  process.env.npm_lifecycle_event === 'build' ||
  process.env.NEXT_PHASE === 'build' ||
  process.env.NEXT_PHASE === 'phase-production-build';

// Required for the app to function at all — the primary ckSurf database.
const requiredSchema = z.object({
  MYSQL_HOST: z.string().min(1, 'MYSQL_HOST is required'),
  MYSQL_USER: z.string().min(1, 'MYSQL_USER is required'),
  MYSQL_PASSWORD: z.string().min(1, 'MYSQL_PASSWORD is required'),
  MYSQL_DATABASE: z.string().min(1, 'MYSQL_DATABASE is required'),
});

// Optional infra vars with safe fallbacks — validated for shape when present so
// a typo (e.g. a non-numeric RATE_LIMIT_MAX or bad LOG_LEVEL) is caught at boot
// rather than silently falling back at request time.
const optionalSchema = z.object({
  MYSQL_PORT: z.coerce.number().int().positive().optional(),
  ANALYTICS_MYSQL_PORT: z.coerce.number().int().positive().optional(),
  // How often to re-check the analytics DB connection (ms). 0 disables re-checks.
  ANALYTICS_HEALTHCHECK_INTERVAL_MS: z.coerce.number().int().nonnegative().optional(),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_PAGE_MAX: z.coerce.number().int().positive().optional(),
  DB_MAX_CONCURRENT_EXPENSIVE: z.coerce.number().int().positive().optional(),
  // MySQL connection pool tuning (see lib/db.ts for defaults).
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().optional(),
  DB_QUEUE_LIMIT: z.coerce.number().int().nonnegative().optional(),
  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  // Background warmer for the default players-list pages.
  PLAYERS_LIST_WARM_PAGES: z.coerce.number().int().positive().optional(),
  PLAYERS_LIST_WARM_INTERVAL_MS: z.coerce.number().int().positive().optional(),
  // Comma-separated extra origins allowed to call the API (own origin always allowed).
  ALLOWED_ORIGINS: z.string().optional(),
  // Canonical public base URL (e.g. https://stats.example.com). Used for
  // robots.txt / sitemap.xml absolute URLs; falls back to the request host.
  NEXT_PUBLIC_SITE_URL: z.url('NEXT_PUBLIC_SITE_URL must be a valid URL').optional(),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .optional(),
  MAP_IMAGES_URL: z.url('MAP_IMAGES_URL must be a valid URL').optional(),
  // Highest tier shown on the player Tier Distribution radar.
  MAX_TIER: z.coerce.number().int().positive().optional(),
});

let validated = false;

/**
 * Validate environment variables at server startup. Idempotent and a no-op
 * during the build phase. Throws if any required variable is missing/invalid;
 * warns (but continues) for unset optional features.
 */
export function validateEnv(): void {
  if (isBuildPhase || validated) return;

  // 1. Required vars — fail fast with an aggregated, actionable message.
  const required = requiredSchema.safeParse(process.env);
  const optional = optionalSchema.safeParse(process.env);

  const issues = [
    ...(required.success ? [] : required.error.issues),
    ...(optional.success ? [] : optional.error.issues),
  ];
  if (issues.length > 0) {
    const details = issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`[env] Invalid environment configuration:\n${details}`);
  }

  // 2. Optional features — warn clearly when disabled so operators aren't
  //    surprised by silently-missing functionality.
  if (!process.env.STEAM_API_KEY) {
    logger.warn('[env] STEAM_API_KEY not set — Steam profile names/avatars will be unavailable');
  }

  const serversJson = process.env.SERVERS_JSON?.trim();
  if (!serversJson || serversJson === '[]') {
    logger.warn('[env] SERVERS_JSON not set (or empty) — live server status will be empty');
  } else {
    // Mirror the quote-stripping in cache.ts so the warning matches runtime parsing.
    let candidate = serversJson;
    if (candidate.startsWith("'") && candidate.endsWith("'")) {
      candidate = candidate.slice(1, -1);
    }
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (!Array.isArray(parsed)) {
        logger.warn('[env] SERVERS_JSON is not a JSON array — live server status will be empty');
      }
    } catch {
      logger.warn('[env] SERVERS_JSON is not valid JSON — live server status will be empty');
    }
  }

  const analyticsConfigured = Boolean(
    process.env.ANALYTICS_MYSQL_HOST ||
      process.env.ANALYTICS_MYSQL_DATABASE ||
      (process.env.MYSQL_HOST && process.env.MYSQL_DATABASE)
  );
  if (!analyticsConfigured) {
    logger.warn('[env] Analytics DB not configured — activity/time-on-server analytics disabled');
  }

  validated = true;
  logger.info('[env] Environment validation passed');
}
