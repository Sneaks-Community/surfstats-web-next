import 'server-only';
import { NextResponse } from 'next/server';
import logger from './logger';
import { validateMapName } from './validators';
import { parseIntParam } from './utils';
import { getErrorMessage } from './errors';

/** Cache-Control header used by the map search endpoints. */
export const SEARCH_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=30';

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
 * Parse and clamp `page`/`pageSize` search params. NaN/negative/oversized inputs
 * fall back or clamp rather than producing invalid offsets.
 */
export function parsePageParams(
  searchParams: URLSearchParams,
  defaultPageSize: number,
  maxPageSize: number
): { page: number; pageSize: number } {
  const page = parseIntParam(searchParams.get('page'), { fallback: 1, min: 1 });
  const pageSize = parseIntParam(searchParams.get('pageSize'), {
    fallback: defaultPageSize,
    min: 1,
    max: maxPageSize,
  });
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
  return NextResponse.json({ error: clientMessage }, { status });
}
