import 'server-only';
import type { NextRequest } from 'next/server';
import logger from './logger';
import { getEnv } from './env';

// Use a CDN's header when the CDN, not the local proxy, is the trust boundary.
const TRUSTED_HEADER = getEnv().TRUSTED_CLIENT_IP_HEADER;

let warned = false;

// Once per process: the fix is a config change, so repeats would only bury other logs.
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
 * From the trusted header, else `x-real-ip`. Takes the right-most entry (the hop the proxy
 * appended; clients can forge the left-most), so it assumes one trusted hop.
 * `null` = no forwarding header; `''` = present but unusable. Trust gates must tell them apart.
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
