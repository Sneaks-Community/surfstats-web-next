import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { isTrustedRequest } from '@/lib/origin-guard';
import { waitForCacheReady } from '@/lib/valkey';
import { cacheUnavailableHtml, tooManyRequestsHtml } from '@/lib/cache-unavailable-page';
import { STATIC_SECURITY_HEADERS, contentSecurityPolicy } from '@/lib/security-headers';

// `next.config.ts`'s headers() only runs for routes the app renders, so every
// short-circuit below has to carry the security headers itself. None of them
// contains a script, hence no nonce.
const shortCircuitHeaders: Record<string, string> = {
  ...STATIC_SECURITY_HEADERS,
  'Content-Security-Policy': contentSecurityPolicy(),
};

// Runs on the Node.js runtime so it can reuse the node-redis Valkey client
// (unavailable on Edge).
export const config = {
  matcher: [
    // Everything except Next's immutable build assets. Deliberately no
    // dot-excluding pattern: a dotted path (`/players/1.1`, `/api/maps/a.b/records`)
    // is a page or route like any other and must not skip the gates below.
    // `/public` holds no files, so nothing else is served statically.
    '/((?!_next/static).*)',
  ],
};

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');

  // Exempt before every gate, primarily the origin guard: the healthcheck's wget
  // sends no Origin or Sec-Fetch-*, so that guard would 403 it. The route touches
  // nothing, and metering it would cost a Valkey round-trip to serve a constant.
  // Exact match, never a prefix.
  if (pathname === '/api/health') {
    return NextResponse.next();
  }

  // Cache is a required layer for every route: without it we serve a graceful
  // "temporarily unavailable" rather than run uncached DB queries on every hit.
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

  // Pages too, not just the API: they run the same user-parameterized heavy
  // queries. Separate budget per scope — the router's RSC requests (a prefetch
  // for every viewport `<Link>`, ~38 on the home page alone) must not spend the
  // same allowance as real navigations.
  //
  // Do NOT test `next-router-prefetch`/`rsc` here: Next strips every flight
  // header before middleware runs, so those checks are always false and the
  // whole prefetch fan-out lands on the page budget (see FLIGHT_HEADERS in
  // `next/dist/server/web/adapter.js`, "Ensure users only see page requests").
  // `Sec-Fetch-Dest` survives, and browsers send `document` only for a real
  // navigation. Missing header (older browsers, crawlers, curl) counts as a
  // navigation, the stricter budget.
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

    // Only a real navigation gets the HTML page. An RSC request (prefetch or
    // client-side navigation) cannot parse HTML as flight data, so the router
    // throws and retries; a bodyless 429 makes it drop the prefetch quietly.
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

  // A fresh nonce per request, forwarded on the request so Next can stamp it
  // onto the scripts it emits (and so `app/layout.tsx` can read it back for the
  // theme bootstrap), and set on the response so the browser enforces it.
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
