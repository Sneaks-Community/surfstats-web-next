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
    // API routes match unconditionally. They must NOT go through the
    // dot-excluding pattern below: user-supplied path segments legitimately
    // contain dots (`/api/maps/foo.bar/records`), and such a request would then
    // skip the cache gate, origin guard and rate limiter entirely — a free
    // unmetered path into the route handlers.
    '/api/:path*',
    // Pages: everything except Next internals and static files (anything with a
    // dot), so the cache-readiness gate and page rate limit cover pages too.
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

  // Rate limiting covers pages as well as the API. Page routes run the same
  // uncached, user-parameterized heavy queries (`/search?q=`, `/players?page=`),
  // so limiting only `/api/*` left the documented cache-miss-cycling attack
  // reachable one URL over. Separate budget per scope.
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
