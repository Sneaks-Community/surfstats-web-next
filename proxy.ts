import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';

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
