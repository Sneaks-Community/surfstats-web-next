import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { isTrustedRequest } from '@/lib/origin-guard';
import { waitForCacheReady } from '@/lib/valkey';
import { cacheUnavailableHtml, tooManyRequestsHtml } from '@/lib/cache-unavailable-page';
import { STATIC_SECURITY_HEADERS, contentSecurityPolicy } from '@/lib/security-headers';

// next.config.ts headers() only reach rendered routes, so each short-circuit below carries the
// security headers itself. None contains a script, hence no nonce.
const shortCircuitHeaders: Record<string, string> = {
  ...STATIC_SECURITY_HEADERS,
  'Content-Security-Policy': contentSecurityPolicy(),
};

// Runs on the Node.js runtime so it can reuse the node-redis Valkey client (unavailable on Edge).
export const config = {
  matcher: [
    // All but Next's build assets (the slash matters: bare `/_next/static` renders a page). No
    // dot-exclusion: dotted paths (`/players/1.1`) are pages and must hit the gates; `/public` is empty.
    '/((?!_next/static/).*)',
  ],
};

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Decoded, so an encoded `/%61pi/...` meets the API gates whatever Next's router decodes.
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Malformed escape: Next cannot route it either.
  }
  const isApi = decoded.startsWith('/api/');

  // Exempt before every gate: the healthcheck's wget sends no Origin/Sec-Fetch-*, so the origin guard
  // would 403 it, and metering a route that touches nothing costs a Valkey round-trip. Exact match only.
  if (pathname === '/api/health') {
    return NextResponse.next();
  }

  // The cache is required: without it, serve "temporarily unavailable" rather than run uncached
  // DB queries on every hit.
  if (!(await waitForCacheReady())) {
    if (isApi) {
      return NextResponse.json(
        { error: 'Service temporarily unavailable' },
        { status: 503, headers: { ...shortCircuitHeaders, 'Retry-After': '5' } }
      );
    }
    return new NextResponse(cacheUnavailableHtml(), {
      status: 503,
      headers: {
        ...shortCircuitHeaders,
        'content-type': 'text/html; charset=utf-8',
        'Retry-After': '5',
        'X-Robots-Tag': 'noindex',
      },
    });
  }

  // The origin guard is API-only: pages must stay publicly reachable (direct
  // navigation and crawlers send no same-origin Referer/Origin).
  if (isApi && !isTrustedRequest(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: shortCircuitHeaders });
  }

  // Pages are metered too (same user-parameterized heavy queries), on a budget separate from the
  // router's RSC requests (client-side navigations; Link prefetch is off, see components/Link.tsx).
  // Don't test `next-router-prefetch`/`rsc`: Next strips flight headers before this runs, so they're
  // always false (FLIGHT_HEADERS in next/dist/server/web/adapter.js). `Sec-Fetch-Dest: document`
  // survives and marks a real navigation; a missing header (old browsers, crawlers, curl) counts as
  // one, the stricter budget.
  const isNavigation = (request.headers.get('sec-fetch-dest') ?? 'document') === 'document';
  const result = await checkRateLimit(request, isApi ? 'api' : isNavigation ? 'page' : 'prefetch');

  if (!result.allowed) {
    const rateLimitHeaders = {
      ...shortCircuitHeaders,
      'X-RateLimit-Limit': String(result.limit),
      'X-RateLimit-Remaining': '0',
      'Retry-After': String(result.resetSeconds),
    };

    if (isApi) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: rateLimitHeaders }
      );
    }

    // HTML only for real navigations: the router can't parse HTML as flight data, so it throws and
    // retries, while a bodyless 429 makes it drop the prefetch quietly.
    if (!isNavigation) {
      return new NextResponse(null, { status: 429, headers: rateLimitHeaders });
    }

    return new NextResponse(tooManyRequestsHtml(result.resetSeconds), {
      status: 429,
      headers: {
        ...rateLimitHeaders,
        'content-type': 'text/html; charset=utf-8',
        'X-Robots-Tag': 'noindex',
      },
    });
  }

  // Fresh nonce per request: on the request so Next stamps its scripts (and app/layout.tsx reads it
  // for the theme bootstrap), on the response so the browser enforces it.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-RateLimit-Limit', String(result.limit));
  response.headers.set('X-RateLimit-Remaining', String(result.remaining));
  return response;
}
