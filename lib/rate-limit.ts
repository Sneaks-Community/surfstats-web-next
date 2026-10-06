import 'server-only';
import type { NextRequest } from 'next/server';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import client from './valkey';
import logger from './logger';
import { getErrorMessage } from './errors';
import { getClientIp } from './client-ip';
import { getEnv } from './env';

// Fixed-window per-IP limiter in Valkey. Cache keys embed user input (page, q, pageSize), so
// varying them forces uncached full-table scans that exhaust the MySQL pool; the cap bounds that.
// Pages count too (same queries), each scope on its own budget. With Valkey down, an in-process
// fallback keeps the same budget per instance (multiplied by instance count, never synced back).

const env = getEnv();
const WINDOW_SECONDS = env.RATE_LIMIT_WINDOW_SECONDS;
const MAX_REQUESTS = env.RATE_LIMIT_MAX;
// More generous than the API's: one page view fans out into several API calls.
const PAGE_MAX_REQUESTS = env.RATE_LIMIT_PAGE_MAX;
// RSC requests get their own, larger budget: every viewport `<Link>` prefetches (dozens per page).
// Next strips flight headers before the proxy, so client navigations (`sec-fetch-dest: empty`)
// count here too, and so would a forged header.
const PREFETCH_MAX_REQUESTS = env.RATE_LIMIT_PREFETCH_MAX;
// Optional penalty: seconds an IP stays blocked from the moment it blows a budget, replacing
// (not extending) the window reset. 0 (default) disables it.
const BLOCK_SECONDS = env.RATE_LIMIT_BLOCK_SECONDS;

/** Which budget a request counts against; each scope has its own counter. */
export type RateLimitScope = 'api' | 'page' | 'prefetch';

const MAX_BY_SCOPE: Record<RateLimitScope, number> = {
  api: MAX_REQUESTS,
  page: PAGE_MAX_REQUESTS,
  prefetch: PREFETCH_MAX_REQUESTS,
};

function buildLimiter(scope: RateLimitScope): RateLimiterRedis {
  const points = MAX_BY_SCOPE[scope];
  return new RateLimiterRedis({
    storeClient: client,
    useRedisPackage: true,
    // Keys: `surfstats:ratelimit:<scope>:<ip>`, under the app-wide prefix.
    keyPrefix: `surfstats:ratelimit:${scope}`,
    points,
    duration: WINDOW_SECONDS,
    blockDuration: BLOCK_SECONDS,
    // Reject over-budget IPs in-process, sparing Valkey a round trip per flood request. Unset,
    // the block lasts the key's real TTL (accurate `Retry-After`); with a penalty both durations
    // must be it, or the library never applies the store-side block.
    inMemoryBlockOnConsumed: points + 1,
    inMemoryBlockDuration: BLOCK_SECONDS || undefined,
    // Throw instead of queueing behind a reconnect, handing off to the insurance limiter.
    rejectIfRedisNotReady: true,
    insuranceLimiter: new RateLimiterMemory({
      keyPrefix: `surfstats:ratelimit:${scope}`,
      points,
      duration: WINDOW_SECONDS,
    }),
  });
}

const limiters: Record<RateLimitScope, RateLimiterRedis> = {
  api: buildLimiter('api'),
  page: buildLimiter('page'),
  prefetch: buildLimiter('prefetch'),
};

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets, for `Retry-After`. */
  resetSeconds: number;
}

/** `Retry-After` is whole seconds and must never be 0, or clients retry instantly. */
function toResetSeconds(msBeforeNext: number): number {
  return Math.max(1, Math.ceil(msBeforeNext / 1000));
}

/**
 * Charges one point to the caller's `scope` budget. Logs the tripping request at `warn` once per
 * IP per window; at `debug`, the budget's last quarter and each blocked retry (no count: blocks
 * are served in-process).
 */
export async function checkRateLimit(
  request: NextRequest,
  scope: RateLimitScope
): Promise<RateLimitResult> {
  // An unidentifiable caller shares one bucket rather than escaping the limit.
  const ip = getClientIp(request) || 'unknown';
  const limit = MAX_BY_SCOPE[scope];
  const path = request.nextUrl.pathname;

  try {
    const res = await limiters[scope].consume(ip);
    // Log the last quarter so the trace shows what spent the budget.
    if (res.remainingPoints < limit / 4) {
      logger.debug(
        `[RateLimit] ${ip} down to ${res.remainingPoints}/${limit} ${scope} points: ${path}`
      );
    }
    return {
      allowed: true,
      limit,
      remaining: res.remainingPoints,
      resetSeconds: toResetSeconds(res.msBeforeNext),
    };
  } catch (err) {
    // An Error (not RateLimiterRes) means both stores failed; fail open so an outage
    // degrades protection, not the API.
    if (!(err instanceof RateLimiterRes)) {
      logger.warn(
        `[RateLimit] Check failed, allowing request: ${getErrorMessage(err)}`
      );
      return { allowed: true, limit, remaining: limit, resetSeconds: WINDOW_SECONDS };
    }

    const resetSeconds = toResetSeconds(err.msBeforeNext);
    // The in-process block list reports 0 points, so this fires once per IP per window.
    if (err.consumedPoints > 0) {
      // Spend time and referer tell a runaway client (seconds, one referer) from heavy real
      // browsing (most of the window).
      const spentMs = Math.max(0, WINDOW_SECONDS * 1000 - err.msBeforeNext);

      const referer = request.headers.get('referer') || 'none';
      logger.warn(
        `[RateLimit] ${ip} exceeded the ${scope} budget (${limit}/${WINDOW_SECONDS}s) in ${spentMs}ms on ${path} (referer ${referer}), blocked for ${resetSeconds}s${BLOCK_SECONDS ? ' (penalty)' : ' (window reset)'}`
      );
    } else {
      logger.debug(
        `[RateLimit] ${ip} still blocked on ${scope} (${resetSeconds}s left): ${path}`
      );
    }

    return { allowed: false, limit, remaining: 0, resetSeconds };
  }
}
