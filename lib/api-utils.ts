import 'server-only';
import { NextResponse } from 'next/server';
import logger from './logger';
import { validateMapName, validateSteamId } from './validators';
import { parseIntParam, ITEMS_PER_PAGE, RECORDS_PAGE_SIZE } from './utils';
import { getErrorMessage, CacheUnavailableError } from './errors';

/** Cache-Control header used by the map search endpoints. */
export const SEARCH_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=30';

/**
 * Cache-Control for the paginated record/stage/bonus endpoints. Lets a shared
 * cache/CDN absorb repeated identical page requests (aligns with the 5-min
 * server-side cache); browsers still revalidate.
 */
export const RECORDS_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';

/**
 * Decode and validate a `mapname` route param.
 * @returns the validated mapname, or a 400 `NextResponse` the caller should return as-is.
 *   Usage: `const m = resolveMapnameParam(raw); if (m instanceof NextResponse) return m;`
 */
export function resolveMapnameParam(raw: string): string | NextResponse {
  const valid = validateMapName(decodeURIComponent(raw));
  if (!valid) {
    return NextResponse.json({ error: 'Invalid map name' }, { status: 400 });
  }
  return valid;
}

/**
 * Decode and validate a `steamid` route param.
 * @returns the validated SteamID, or a 400 `NextResponse` the caller should return as-is.
 *   Usage: `const s = resolveSteamIdParam(raw); if (s instanceof NextResponse) return s;`
 *
 * Unlike the player page (which falls back to the raw value), the API rejects
 * an invalid SteamID outright so a malformed id never reaches a cache/DB query.
 */
export function resolveSteamIdParam(raw: string): string | NextResponse {
  const valid = validateSteamId(decodeURIComponent(raw));
  if (!valid) {
    return NextResponse.json({ error: 'Invalid SteamID' }, { status: 400 });
  }
  return valid;
}

/** Absolute backstop on `page`; routes with a known row count clamp tighter. */
export const MAX_PAGE = 10000;

// Defined in `utils` because the client's load-all loop needs the same value and
// cannot import this module; re-exported so server callers keep one import.
export { RECORDS_PAGE_SIZE };

/**
 * Parse and clamp `page`/`pageSize` search params. NaN/negative/oversized inputs
 * fall back or clamp rather than producing invalid offsets. `page` is capped at
 * `maxPage` (default {@link MAX_PAGE}).
 */
export function parsePageParams(
  searchParams: URLSearchParams,
  defaultPageSize: number,
  maxPageSize: number,
  maxPage: number = MAX_PAGE
): { page: number; pageSize: number } {
  const page = parseIntParam(searchParams.get('page'), { fallback: 1, min: 1, max: maxPage });
  const raw = parseIntParam(searchParams.get('pageSize'), {
    fallback: defaultPageSize,
    min: 1,
    max: maxPageSize,
  });
  // Snapped to the only two sizes the UI requests. Anything else is pure
  // cache-key churn, and `pageSize=1` multiplies the clamped page count by 100.
  const pageSize = raw <= ITEMS_PER_PAGE ? ITEMS_PER_PAGE : RECORDS_PAGE_SIZE;
  return { page, pageSize };
}

/**
 * Log an error server-side (via Pino) and build the client-facing error response.
 * Keeps internal messages out of the response body.
 */
export function apiError(
  logLabel: string,
  error: unknown,
  clientMessage: string,
  status = 500
): NextResponse {
  logger.error(`${logLabel}: ${getErrorMessage(error)}`);
  // Cache down: mirror the proxy's 503 for the post-gate race.
  if (error instanceof CacheUnavailableError) {
    return NextResponse.json(
      { error: 'Service temporarily unavailable' },
      { status: 503, headers: { 'Retry-After': '5' } }
    );
  }
  return NextResponse.json({ error: clientMessage }, { status });
}
