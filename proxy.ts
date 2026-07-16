import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { isTrustedRequest } from '@/lib/origin-guard';

// Proxy always runs on the Node.js runtime, so it can reuse the existing
// node-redis Valkey client (unavailable on the Edge runtime).
export const config = {
  matcher: '/api/:path*',
};

export async function proxy(request: NextRequest) {
  // Keep the health endpoint always reachable for container/orchestrator probes.
  if (request.nextUrl.pathname === '/api/health') {
    return NextResponse.next();
  }

  // Lock the API to the site itself (and any allow-listed origins). Cheap and
  // runs before rate limiting so cross-origin/naive scrapers never touch Valkey.
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
