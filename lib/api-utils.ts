import 'server-only';
import { NextResponse } from 'next/server';
import logger from './logger';
import { validateMapName, validateSteamId } from './validators';
import { parseIntParam, ITEMS_PER_PAGE, RECORDS_PAGE_SIZE } from './utils';
import { getErrorMessage, CacheUnavailableError, DbBusyError } from './errors';

/** Cache-Control for the map search endpoints. */
export const SEARCH_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=30';

/**
 * For the paginated record/stage/bonus endpoints: a shared cache/CDN absorbs repeated requests
 * (aligned with the 5-min server-side cache); browsers still revalidate.
 */
export const RECORDS_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';

/** Decodes and validates `mapname`; returns it, or a 400 `NextResponse` to return as-is. */
export function resolveMapnameParam(raw: string): string | NextResponse {
  const valid = validateMapName(decodeURIComponent(raw));
  if (!valid) {
    return NextResponse.json({ error: 'Invalid map name' }, { status: 400 });
  }
  return valid;
}

/**
 * Decodes and validates `steamid`; returns it, or a 400 `NextResponse` to return as-is. Unlike
 * the player page (raw fallback), this keeps a malformed id out of cache keys and DB queries.
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

/** NaN, negative or oversized values fall back or clamp; `page` is capped at {@link MAX_PAGE}. */
export function parsePageParams(searchParams: URLSearchParams): { page: number; pageSize: number } {
  const page = parseIntParam(searchParams.get('page'), { max: MAX_PAGE });
  const raw = parseIntParam(searchParams.get('pageSize'), { fallback: RECORDS_PAGE_SIZE });
  // Snap to the UI's two sizes: others are cache-key churn, and `pageSize=1` would multiply the
  // reachable page count by 100.
  const pageSize = raw <= ITEMS_PER_PAGE ? ITEMS_PER_PAGE : RECORDS_PAGE_SIZE;
  return { page, pageSize };
}

/** Logs the error and returns `clientMessage`, keeping internals out of the response. */
export function apiError(
  logLabel: string,
  error: unknown,
  clientMessage: string,
  status = 500
): NextResponse {
  // Cache down (the proxy's 503, for requests past its gate) or DB queue full: both transient.
  // Not logged, since a flood would log every rejection; the cache and semaphore each report
  // their episode once, with a count.


  if (error instanceof CacheUnavailableError || error instanceof DbBusyError) {
    return NextResponse.json(
      { error: 'Service temporarily unavailable' },
      { status: 503, headers: { 'Retry-After': '5' } }
    );
  }
  logger.error(`${logLabel}: ${getErrorMessage(error)}`);
  return NextResponse.json({ error: clientMessage }, { status });
}
