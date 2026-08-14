import 'server-only';
import type { NextRequest } from 'next/server';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import client from './valkey';
import logger from './logger';
import { getClientIp } from './client-ip';

/**
 * Fixed-window, per-IP rate limiter backed by Valkey, implemented with
 * `rate-limiter-flexible`'s `RateLimiterRedis` (one atomic Lua INCR + PTTL per
 * request).
 *
 * Defense against cache-miss-cycling: cache keys embed user-controlled values
 * (`page`, `q`, `pageSize`), so an attacker can vary them to force uncached
 * `ROW_NUMBER()`/`DENSE_RANK()` full-table scans and exhaust the ~20-connection
 * MySQL pool. Capping requests per IP bounds that blast radius.
 *
 * Applies to page routes as well as `/api/*`, since they run the same queries.
 * Each scope gets an independent budget and counter so a page render's own
 * client-side API fetches, and the router's link prefetches, don't eat the
 * browsing allowance.
 *
 * If Valkey is unreachable the request falls through to an in-process
 * `RateLimiterMemory` with the same budget (`insuranceLimiter`), so an outage
 * degrades the limiter to per-instance accounting rather than dropping it. The
 * budget is effectively multiplied by the number of app instances for as long
 * as the outage lasts, and the fallback's counters are not synced back.
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
/**
 * The router's RSC requests get their own, much larger budget. Every viewport
 * `<Link>` prefetches, so a single link-dense page view (~38 on the home page)
 * is dozens of requests — charging those to the page budget rate limited
 * ordinary browsing after two or three clicks.
 *
 * Next strips its flight headers before middleware, so the proxy cannot tell a
 * prefetch (renders only to the `loading.tsx` boundary) from a client-side
 * navigation (full render); both arrive as `sec-fetch-dest: empty` and count
 * here. The cap therefore also bounds a caller who forges that header.
 */
const PREFETCH_MAX_REQUESTS = Math.max(
  1,
  parseInt(process.env.RATE_LIMIT_PREFETCH_MAX || '900', 10) || 900
);
/**
 * Optional penalty: keep an IP blocked this many seconds after it blows a
 * budget, instead of letting it back in when the window rolls over. Unset (0)
 * disables it, which is the default and matches pre-library behavior.
 */
const BLOCK_SECONDS = Math.max(
  0,
  parseInt(process.env.RATE_LIMIT_BLOCK_SECONDS || '0', 10) || 0
);

/** Which budget a request counts against. */
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
    // Keys land at `surfstats:ratelimit:<scope>:<ip>`, inside the prefix the
    // rest of the codebase (and any `SCAN surfstats:*`) uses.
    keyPrefix: `surfstats:ratelimit:${scope}`,
    points,
    duration: WINDOW_SECONDS,
    blockDuration: BLOCK_SECONDS,
    // Once an IP is over budget, reject it in-process instead of paying a
    // Valkey round-trip per request — the flood case this limiter exists for.
    // Leaving `inMemoryBlockDuration` unset holds the key for its real
    // remaining TTL, so `Retry-After` stays accurate; when a block penalty is
    // configured both durations must be it, or the library takes an earlier
    // branch and never applies the store-side block.
    inMemoryBlockOnConsumed: points + 1,
    inMemoryBlockDuration: BLOCK_SECONDS || undefined,
    // Don't let a command queue behind a reconnect on the request path: a
    // not-ready client throws immediately, which hands off to the fallback.
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
  /** Seconds until the current window resets (used for the `Retry-After` header). */
  resetSeconds: number;
}

/** `Retry-After` is whole seconds and must never be 0, or clients retry instantly. */
function toResetSeconds(msBeforeNext: number): number {
  return Math.max(1, Math.ceil(msBeforeNext / 1000));
}

/**
 * Charge one point to the caller's window and report whether they are within
 * the limit.
 *
 * Logs the request that trips a budget at `warn` (once per IP per window) and
 * every further request made while blocked at `debug` (set `LOG_LEVEL=debug` to
 * see whether a blocked caller backs off or keeps hammering). Because blocked
 * callers are rejected from the in-process block list, the debug line cannot
 * report how many requests they have made since — only that they are still
 * coming.
 *
 * @param request - The incoming request (for client-IP resolution)
 * @param scope - Which budget to charge; each scope counts separately
 */
export async function checkRateLimit(
  request: NextRequest,
  scope: RateLimitScope = 'api'
): Promise<RateLimitResult> {
  // An unidentifiable caller shares one bucket rather than escaping the limit.
  const ip = getClientIp(request) || 'unknown';
  const limit = MAX_BY_SCOPE[scope];

  try {
    const res = await limiters[scope].consume(ip);
    return {
      allowed: true,
      limit,
      remaining: res.remainingPoints,
      resetSeconds: toResetSeconds(res.msBeforeNext),
    };
  } catch (err) {
    // The library rejects with a RateLimiterRes when the limit is hit and with
    // an Error when the store failed. The latter should be unreachable now that
    // an in-memory insurance limiter backs every scope, but if both ever fail
    // the request is allowed: an outage should degrade protection, not the API.
    if (!(err instanceof RateLimiterRes)) {
      logger.warn(
        `[RateLimit] Check failed, allowing request: ${err instanceof Error ? err.message : String(err)}`
      );
      return { allowed: true, limit, remaining: limit, resetSeconds: WINDOW_SECONDS };
    }

    const resetSeconds = toResetSeconds(err.msBeforeNext);
    const path = request.nextUrl.pathname;
    // Only the store-side rejection carries a point count; the in-process block
    // list reports 0. That makes this exactly one line per IP per window.
    if (err.consumedPoints > 0) {
      logger.warn(
        `[RateLimit] ${ip} exceeded the ${scope} budget (${limit}/${WINDOW_SECONDS}s) on ${path}, blocked for ${resetSeconds}s`
      );
    } else {
      logger.debug(
        `[RateLimit] ${ip} still blocked on ${scope} (${resetSeconds}s left): ${path}`
      );
    }

    return { allowed: false, limit, remaining: 0, resetSeconds };
  }
}
