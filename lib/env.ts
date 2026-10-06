import 'server-only';
import { z } from 'zod';
import logger from './logger';
import { COLOR_FAMILIES, BACKGROUND_FAMILIES } from './theme-config';
import { isValidTimeZone } from './utils';

// One schema: `validateEnv()` fails the boot on bad vars; `getEnv()` serves every module the
// optional vars with defaults. `logger` and `theme-config` read env directly (they'd import
// this in a cycle), as does `utils` (it runs on the client).

/** True during `next build`, where env vars are absent and no server runs. */
export const isBuildPhase =
  process.env.npm_lifecycle_event === 'build' ||
  process.env.NEXT_PHASE === 'phase-production-build';

const requiredSchema = z.object({
  MYSQL_HOST: z.string().min(1, 'MYSQL_HOST is required'),
  MYSQL_USER: z.string().min(1, 'MYSQL_USER is required'),
  MYSQL_PASSWORD: z.string().min(1, 'MYSQL_PASSWORD is required'),
  MYSQL_DATABASE: z.string().min(1, 'MYSQL_DATABASE is required'),
  // Canonical public base URL. Required: unset, the origin guard and absolute links fall back
  // to the client-spoofable Host / X-Forwarded-Host headers.
  NEXT_PUBLIC_SITE_URL: z.url(
    'NEXT_PUBLIC_SITE_URL is required and must be an absolute URL (e.g. https://stats.example.com)'
  ),
});

// Optional vars and the defaults every module reads. Shape-checked when present so a typo
// fails the boot instead of silently defaulting.
const optionalSchema = z.object({
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  // Falls back to MYSQL_PORT.
  ANALYTICS_MYSQL_PORT: z.coerce.number().int().positive().optional(),
  // Analytics DB re-check interval (ms); 0 disables, else floored at 10s so a typo can't hammer it.
  ANALYTICS_HEALTHCHECK_INTERVAL_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .transform((ms) => (ms === 0 ? 0 : Math.max(10_000, ms)))
    .default(60_000),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_PAGE_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_PREFETCH_MAX: z.coerce.number().int().positive().default(900),
  // 0 means a blown budget clears when the window rolls over.
  RATE_LIMIT_BLOCK_SECONDS: z.coerce.number().int().nonnegative().default(0),
  DB_MAX_CONCURRENT_EXPENSIVE: z.coerce.number().int().positive().default(6),
  // Callers allowed to wait for a slot; past it they get a 503 (default: 2x above).
  DB_MAX_QUEUED_EXPENSIVE: z.coerce.number().int().positive().optional(),
  // MySQL connection pool tuning; 0 queue limit is mysql2's "unlimited".
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(20),
  DB_QUEUE_LIMIT: z.coerce.number().int().nonnegative().default(100),
  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  // Server-side per-statement cap (see lib/timeout.ts). 0 disables it.
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(8000),
  // Background warmer for the default players-list pages; at most once a minute.
  PLAYERS_LIST_WARM_PAGES: z.coerce.number().int().positive().default(10),
  PLAYERS_LIST_WARM_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .transform((ms) => Math.max(60_000, ms))
    .default(300_000),
  // Comma-separated extra origins allowed to call the API (own origin always allowed).
  ALLOWED_ORIGINS: z
    .string()
    .transform((list) => list.split(',').map((o) => o.trim()).filter(Boolean))
    .default([]),
  // Valkey (lib/valkey.ts) is fail-closed, so a typo here is a site outage unless caught at boot.
  VALKEY_URL: z
    .url({ protocol: /^rediss?$/, error: 'VALKEY_URL must be a redis:// or rediss:// URL' })
    .default('redis://localhost:6379'),
  VALKEY_USERNAME: z.string().min(1).optional(),
  VALKEY_PASSWORD: z.string().min(1).optional(),
  // Exactly 'true' or 'false', so a typo can't silently mean the opposite.
  VALKEY_TLS: z
    .enum(['true', 'false'], "VALKEY_TLS must be 'true' or 'false'")
    .transform((v) => v === 'true')
    .default(false),
  VALKEY_TLS_REJECT_UNAUTHORIZED: z
    .enum(['true', 'false'], "VALKEY_TLS_REJECT_UNAUTHORIZED must be 'true' or 'false'")
    .transform((v) => v === 'true')
    .default(true),
  VALKEY_CONNECT_TIMEOUT: z.coerce.number().int().positive().default(5000),
  // Client-IP header (lib/client-ip.ts); a typo would put every caller in one rate-limit bucket.
  TRUSTED_CLIENT_IP_HEADER: z
    .string()
    .regex(/^[A-Za-z0-9-]+$/, 'TRUSTED_CLIENT_IP_HEADER must be a valid HTTP header name')
    .transform((header) => header.toLowerCase())
    .default('x-forwarded-for'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .optional(),
  MAP_IMAGES_URL: z.url('MAP_IMAGES_URL must be a valid URL').optional(),
  // IANA zone for rendered dates and heatmap day/hour buckets (default UTC). Rejected at boot if
  // unknown to the runtime, since Intl would throw on render.
  DISPLAY_TZ: z
    .string()
    .refine(isValidTimeZone, 'DISPLAY_TZ must be a valid IANA timezone (e.g. UTC, America/New_York)')
    .optional(),
  // Highest tier shown on the player Tier Distribution radar.
  MAX_TIER: z.coerce.number().int().positive().default(10),
  // Palette families, injected as CSS vars by the root layout; an unknown one throws on render.
  THEME_PRIMARY: z.enum(COLOR_FAMILIES).optional(),
  THEME_SECONDARY: z.enum(COLOR_FAMILIES).optional(),
  THEME_LIGHT_PRIMARY: z.enum(COLOR_FAMILIES).optional(),
  THEME_LIGHT_SECONDARY: z.enum(COLOR_FAMILIES).optional(),
  THEME_DARK_PRIMARY: z.enum(COLOR_FAMILIES).optional(),
  THEME_DARK_SECONDARY: z.enum(COLOR_FAMILIES).optional(),
  THEME_LIGHT_BACKGROUND: z.enum(BACKGROUND_FAMILIES).optional(),
  THEME_DARK_BACKGROUND: z.enum(BACKGROUND_FAMILIES).optional(),
});

export type OptionalEnv = z.infer<typeof optionalSchema>;

/**
 * Optional vars with defaults, parsed per call (cheap; tests mutate `process.env`), so read
 * where used. An invalid var falls back to its own default here; `validateEnv` fails the boot.
 */
export function getEnv(): OptionalEnv {
  const parsed = optionalSchema.safeParse(process.env);
  if (parsed.success) return parsed.data;
  return Object.fromEntries(
    Object.entries(optionalSchema.shape).map(([key, field]) => {
      const one = field.safeParse(process.env[key]);
      return [key, one.success ? one.data : field.parse(undefined)];
    })
  ) as OptionalEnv;
}

// Live-status game servers, validated per item so a malformed entry can't reach GameDig.query()
// as an arbitrary host/port.
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

/** Game servers from SERVERS_JSON, parsed once; empty on any error. */
export function getServerConfigs(): ServerConfig[] {
  serverConfigs ??= parseServerConfigs();
  return serverConfigs;
}

let validated = false;

/**
 * Startup check; idempotent and a no-op during build. Throws on missing or invalid vars, and
 * warns for unset optional features so their absence isn't silent.
 */
export function validateEnv(): void {
  if (isBuildPhase || validated) return;

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

  if (!process.env.STEAM_API_KEY) {
    logger.warn('[env] STEAM_API_KEY not set — Steam profile names/avatars will be unavailable');
  }

  // Parses (and warns) once at boot; fetchServersFromGame reuses the result.
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
