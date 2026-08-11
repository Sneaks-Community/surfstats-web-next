import 'server-only';
import type { NextRequest } from 'next/server';
import client from './valkey';
import logger from './logger';

/**
 * Fixed-window, per-IP rate limiter backed by Valkey.
 *
 * Defense against cache-miss-cycling: cache keys embed user-controlled values
 * (`page`, `q`, `pageSize`), so an attacker can vary them to force uncached
 * `ROW_NUMBER()`/`DENSE_RANK()` full-table scans and exhaust the ~20-connection
 * MySQL pool. Capping requests per IP bounds that blast radius.
 *
 * Applies to page routes as well as `/api/*`, since they run the same queries.
 * The two scopes get independent budgets and counters so a page render's own
 * client-side API fetches don't eat the browsing allowance.
 *
 * Fails open: if Valkey is unreachable the request is allowed, so a cache
 * outage degrades protection rather than taking the whole API down.
 */

const WINDOW_SECONDS = Math.max(
  1,
  parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS || '60', 10) || 60
);
const MAX_REQUESTS = Math.max(
  1,
  parseInt(process.env.RATE_LIMIT_MAX || '120', 10) || 120
);
/** More generous than the API's: one page view fans out into several API calls. */
const PAGE_MAX_REQUESTS = Math.max(
  1,
  parseInt(process.env.RATE_LIMIT_PAGE_MAX || '300', 10) || 300
);

/** Which budget a request counts against. */
export type RateLimitScope = 'api' | 'page';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window resets (used for the `Retry-After` header). */
  resetSeconds: number;
}

/**
 * Best-effort client IP from proxy headers. Reads the right-most `x-forwarded-for`
 * hop — the address the edge proxy (Traefik) actually observed and appended, which
 * a client cannot forge — rather than the spoofable left-most entry. Assumes a
 * single trusted proxy hop and that the app is only reachable through it; add a
 * hop for each additional proxy placed in front of Traefik.
 */
function getClientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',');
    const last = parts[parts.length - 1]?.trim();
    if (last) return last;
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Increment the caller's window counter and report whether they are within the
 * limit. Uses a single round-trip MULTI: `INCR` then `EXPIRE ... NX` so the TTL
 * is set once per window (and self-heals if a counter was ever left without one).
 *
 * @param request - The incoming request (for client-IP resolution)
 * @param scope - Which budget to charge; `'api'` and `'page'` count separately
 */
export async function checkRateLimit(
  request: NextRequest,
  scope: RateLimitScope = 'api'
): Promise<RateLimitResult> {
  const ip = getClientIp(request);
  const maxRequests = scope === 'page' ? PAGE_MAX_REQUESTS : MAX_REQUESTS;
  const key = `ratelimit:${scope}:${ip}`;

  try {
    const results = await client
      .multi()
      .incr(key)
      .expire(key, WINDOW_SECONDS, 'NX')
      .pTTL(key)
      .exec();

    const count = Number(results[0]);
    // PTTL gives the true remaining time in the current window; fall back to the
    // full window if the key has no TTL yet (-1) or vanished (-2).
    const pttlMs = Number(results[2]);
    const resetSeconds = pttlMs > 0 ? Math.ceil(pttlMs / 1000) : WINDOW_SECONDS;
    return {
      allowed: count <= maxRequests,
      limit: maxRequests,
      remaining: Math.max(0, maxRequests - count),
      resetSeconds,
    };
  } catch (err) {
    logger.warn(
      `[RateLimit] Check failed, allowing request: ${err instanceof Error ? err.message : String(err)}`
    );
    return {
      allowed: true,
      limit: maxRequests,
      remaining: maxRequests,
      resetSeconds: WINDOW_SECONDS,
    };
  }
}
