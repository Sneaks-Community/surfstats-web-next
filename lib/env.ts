import 'server-only';
import { z } from 'zod';
import logger from './logger';
import { COLOR_FAMILIES, BACKGROUND_FAMILIES } from './theme-config';
import { isValidTimeZone } from './utils';

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
  RATE_LIMIT_PREFETCH_MAX: z.coerce.number().int().positive().optional(),
  // 0 (or unset) means a blown budget clears when the window rolls over.
  RATE_LIMIT_BLOCK_SECONDS: z.coerce.number().int().nonnegative().optional(),
  DB_MAX_CONCURRENT_EXPENSIVE: z.coerce.number().int().positive().optional(),
  // MySQL connection pool tuning (see lib/db.ts for defaults).
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().optional(),
  DB_QUEUE_LIMIT: z.coerce.number().int().nonnegative().optional(),
  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  // Server-side per-statement cap (see lib/timeout.ts). 0 disables it.
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().nonnegative().optional(),
  // Background warmer for the default players-list pages.
  PLAYERS_LIST_WARM_PAGES: z.coerce.number().int().positive().optional(),
  PLAYERS_LIST_WARM_INTERVAL_MS: z.coerce.number().int().positive().optional(),
  // Comma-separated extra origins allowed to call the API (own origin always allowed).
  ALLOWED_ORIGINS: z.string().optional(),
  // Client-IP header (see lib/client-ip.ts). A typo would collapse every caller
  // into one rate-limit bucket, so shape-check it.
  TRUSTED_CLIENT_IP_HEADER: z
    .string()
    .regex(/^[A-Za-z0-9-]+$/, 'TRUSTED_CLIENT_IP_HEADER must be a valid HTTP header name')
    .optional(),
  // Canonical public base URL (e.g. https://stats.example.com). Used for
  // robots.txt / sitemap.xml absolute URLs; falls back to the request host.
  NEXT_PUBLIC_SITE_URL: z.url('NEXT_PUBLIC_SITE_URL must be a valid URL').optional(),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .optional(),
  MAP_IMAGES_URL: z.url('MAP_IMAGES_URL must be a valid URL').optional(),
  // IANA timezone every rendered date and the activity heatmap's day/hour
  // buckets are computed in. Defaults to UTC. Rejected at boot if the runtime
  // does not know the zone, since an unknown one makes Intl throw on render.
  DISPLAY_TZ: z
    .string()
    .refine(isValidTimeZone, 'DISPLAY_TZ must be a valid IANA timezone (e.g. UTC, America/New_York)')
    .optional(),
  // Highest tier shown on the player Tier Distribution radar.
  MAX_TIER: z.coerce.number().int().positive().optional(),
  // Theme palette families. Injected as CSS vars from the root layout, so an
  // unknown value would otherwise throw on every page render.
  THEME_PRIMARY: z.enum(COLOR_FAMILIES).optional(),
  THEME_SECONDARY: z.enum(COLOR_FAMILIES).optional(),
  THEME_LIGHT_PRIMARY: z.enum(COLOR_FAMILIES).optional(),
  THEME_LIGHT_SECONDARY: z.enum(COLOR_FAMILIES).optional(),
  THEME_DARK_PRIMARY: z.enum(COLOR_FAMILIES).optional(),
  THEME_DARK_SECONDARY: z.enum(COLOR_FAMILIES).optional(),
  THEME_LIGHT_BACKGROUND: z.enum(BACKGROUND_FAMILIES).optional(),
  THEME_DARK_BACKGROUND: z.enum(BACKGROUND_FAMILIES).optional(),
});

// Live-status game servers. Validated per item so a malformed entry can't reach
// GameDig.query() as an arbitrary host/port.
const serverConfigSchema = z.object({
  name: z.string().min(1),
  ip: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

let serverConfigs: ServerConfig[] | null = null;

function parseServerConfigs(): ServerConfig[] {
  const raw = process.env.SERVERS_JSON?.trim();
  if (!raw || raw === '[]') {
    logger.warn('[env] SERVERS_JSON not set (or empty) — live server status will be empty');
    return [];
  }

  // Strip surrounding single quotes, which shells and compose files often leave in.
  const candidate = raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1) : raw;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    logger.error('[env] SERVERS_JSON is not valid JSON — live server status will be empty');
    return [];
  }

  const result = z.array(serverConfigSchema).safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    logger.error(`[env] SERVERS_JSON is invalid — live server status will be empty (${details})`);
    return [];
  }
  return result.data;
}

/** Validated game server list from SERVERS_JSON. Parsed once, empty on any error. */
export function getServerConfigs(): ServerConfig[] {
  serverConfigs ??= parseServerConfigs();
  return serverConfigs;
}

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

  // Parse (and warn) once at boot; the result is what fetchServersFromGame uses.
  getServerConfigs();

  // Opt-in only; must match `isAnalyticsConfigured` in lib/db-analytics.ts.
  const analyticsConfigured = Boolean(
    process.env.ANALYTICS_MYSQL_HOST || process.env.ANALYTICS_MYSQL_DATABASE
  );
  if (!analyticsConfigured) {
    logger.warn('[env] Analytics DB not configured — activity/time-on-server analytics disabled');
  }

  validated = true;
  logger.info('[env] Environment validation passed');
}
