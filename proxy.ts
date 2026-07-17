import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { isTrustedRequest } from '@/lib/origin-guard';
import { waitForCacheReady } from '@/lib/valkey';
import { cacheUnavailableHtml } from '@/lib/cache-unavailable-page';

// Runs on the Node.js runtime so it can reuse the node-redis Valkey client
// (unavailable on Edge). Matches all routes except Next internals and static
// files (anything with a dot), so the cache-readiness gate covers pages too.
export const config = {
  matcher: ['/((?!_next/static|_next/image|.*\\..*).*)'],
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

  // The remaining protections apply to the API only.
  if (!isApi) {
    return NextResponse.next();
  }

  // Lock the API to the site itself (and any allow-listed origins).
  if (!isTrustedRequest(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await checkRateLimit(request);

  if (!result.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(result.limit),
          'X-RateLimit-Remaining': '0',
          'Retry-After': String(result.resetSeconds),
        },
      }
    );
  }

  const response = NextResponse.next();
  response.headers.set('X-RateLimit-Limit', String(result.limit));
  response.headers.set('X-RateLimit-Remaining', String(result.remaining));
  return response;
}
