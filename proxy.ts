import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { isTrustedRequest } from '@/lib/origin-guard';
import { waitForCacheReady } from '@/lib/valkey';
import { cacheUnavailableHtml, tooManyRequestsHtml } from '@/lib/cache-unavailable-page';

// Runs on the Node.js runtime so it can reuse the node-redis Valkey client
// (unavailable on Edge).
export const config = {
  matcher: [
    // Unconditional: must not use the dot-excluding pattern below, or a dotted
    // path segment (`/api/maps/foo.bar/records`) skips every gate.
    '/api/:path*',
    // Pages: all but Next internals and static files (anything with a dot).
    '/((?!_next/static|_next/image|.*\\..*).*)',
  ],
};

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');

  // Health endpoint reports status itself; never gate it.
  if (pathname === '/api/health') {
    return NextResponse.next();
  }

  // Cache is a required layer for every route: without it we serve a graceful
  // "temporarily unavailable" rather than run uncached DB queries on every hit.
  if (!(await waitForCacheReady())) {
    if (isApi) {
      return NextResponse.json(
        { error: 'Service temporarily unavailable' },
        { status: 503, headers: { 'Retry-After': '5' } }
      );
    }
    return new NextResponse(cacheUnavailableHtml(), {
      status: 503,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'Retry-After': '5',
        'X-Robots-Tag': 'noindex',
      },
    });
  }

  // The origin guard is API-only: pages must stay publicly reachable (direct
  // navigation and crawlers send no same-origin Referer/Origin).
  if (isApi && !isTrustedRequest(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Pages too, not just the API: they run the same user-parameterized heavy
  // queries. Separate budget per scope.
  const result = await checkRateLimit(request, isApi ? 'api' : 'page');

  if (!result.allowed) {
    const rateLimitHeaders = {
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

    return new NextResponse(tooManyRequestsHtml(result.resetSeconds), {
      status: 429,
      headers: {
        ...rateLimitHeaders,
        'content-type': 'text/html; charset=utf-8',
        'X-Robots-Tag': 'noindex',
      },
    });
  }

  const response = NextResponse.next();
  response.headers.set('X-RateLimit-Limit', String(result.limit));
  response.headers.set('X-RateLimit-Remaining', String(result.remaining));
  return response;
}
