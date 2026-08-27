import 'server-only';
import type { NextRequest } from 'next/server';
import logger from './logger';

/** Set TRUSTED_CLIENT_IP_HEADER to a CDN header when a CDN, not the local proxy, is the trust boundary. */
const TRUSTED_HEADER = (process.env.TRUSTED_CLIENT_IP_HEADER || 'x-forwarded-for')
  .trim()
  .toLowerCase();

let warned = false;

/**
 * Warn the operator that the configured header is missing. Once per process:
 * the fix is a config change, so repeating the line only buries other logs.
 */
function warnUntrusted(hasFallback: boolean): void {
  if (warned) return;
  warned = true;
  logger.warn(
    hasFallback
      ? `[ClientIP] No usable '${TRUSTED_HEADER}' header; keying rate limits on client-supplied x-real-ip. Set TRUSTED_CLIENT_IP_HEADER to the header your proxy overwrites.`
      : `[ClientIP] No usable '${TRUSTED_HEADER}' or x-real-ip header; every request shares one rate-limit bucket. The app must be reached through a proxy that sets a client-IP header.`
  );
}

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
  const trusted = forwarded?.split(',').pop()?.trim();
  const fallback = realIp?.trim();
  if (!trusted) warnUntrusted(Boolean(fallback));
  if (forwarded === null && realIp === null) return null;
  return trusted || fallback || '';
}
