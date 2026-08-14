import 'server-only';
import type { NextRequest } from 'next/server';

/** Set TRUSTED_CLIENT_IP_HEADER to a CDN header when a CDN, not the local proxy, is the trust boundary. */
const TRUSTED_HEADER = (process.env.TRUSTED_CLIENT_IP_HEADER || 'x-forwarded-for')
  .trim()
  .toLowerCase();

/**
 * Client IP from the trusted header, falling back to `x-real-ip`. Takes the
 * right-most comma entry — the hop the proxy appended, which a client cannot
 * forge, unlike the left-most. Assumes a single trusted hop.
 *
 * `null` = no forwarding header at all; `''` = present but unusable. Callers
 * gating on trust must treat those differently.
 */
export function getClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get(TRUSTED_HEADER);
  const realIp = request.headers.get('x-real-ip');
  if (forwarded === null && realIp === null) return null;
  return forwarded?.split(',').pop()?.trim() || realIp?.trim() || '';
}
