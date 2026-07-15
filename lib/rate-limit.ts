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

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window resets (used for the `Retry-After` header). */
  resetSeconds: number;
}

/**
 * Best-effort client IP from proxy headers. Trusts `x-forwarded-for`/`x-real-ip`,
 * so the deployment must terminate at a proxy that sets them (see INF-2 notes).
 */
function getClientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Increment the caller's window counter and report whether they are within the
 * limit. Uses a single round-trip MULTI: `INCR` then `EXPIRE ... NX` so the TTL
 * is set once per window (and self-heals if a counter was ever left without one).
 */
export async function checkRateLimit(request: NextRequest): Promise<RateLimitResult> {
  const ip = getClientIp(request);
  const key = `ratelimit:${ip}`;

  try {
    const results = await client
      .multi()
      .incr(key)
      .expire(key, WINDOW_SECONDS, 'NX')
      .exec();

    const count = Number(results[0]);
    return {
      allowed: count <= MAX_REQUESTS,
      limit: MAX_REQUESTS,
      remaining: Math.max(0, MAX_REQUESTS - count),
      resetSeconds: WINDOW_SECONDS,
    };
  } catch (err) {
    logger.warn(
      `[RateLimit] Check failed, allowing request: ${err instanceof Error ? err.message : String(err)}`
    );
    return {
      allowed: true,
      limit: MAX_REQUESTS,
      remaining: MAX_REQUESTS,
      resetSeconds: WINDOW_SECONDS,
    };
  }
}
