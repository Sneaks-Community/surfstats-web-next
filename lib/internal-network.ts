import 'server-only';
import type { NextRequest } from 'next/server';

/**
 * Extra source IPs (comma-separated) treated as internal, e.g. a monitoring
 * host on a public address. Loopback and RFC1918 private ranges are always
 * treated as internal.
 */
const TRUSTED_INTERNAL_IPS: readonly string[] = (process.env.HEALTH_INTERNAL_IPS || '')
  .split(',')
  .map((ip) => ip.trim())
  .filter(Boolean);

/** Whether an IP literal falls in a loopback / private / link-local range. */
function isPrivateIp(ip: string): boolean {
  // Unwrap IPv6-mapped IPv4 (`::ffff:10.0.0.1`) and drop any zone id.
  const normalized = ip.replace(/^::ffff:/i, '').split('%')[0];
  const lower = normalized.toLowerCase();

  // IPv6 loopback, unique-local (fc00::/7), link-local (fe80::/10).
  if (lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe80')) return true;

  // IPv4 private/loopback/link-local ranges.
  const parts = normalized.split('.');
  if (parts.length === 4) {
    const [a, b] = parts.map((p) => parseInt(p, 10));
    if ([a, b].some((n) => Number.isNaN(n))) return false;
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  }
  return false;
}

/**
 * Whether a request reached the app over the internal network rather than the
 * public reverse proxy. Assumes the deployment is only reachable through a proxy
 * that sets `x-forwarded-for` for public traffic (see the origin/rate-limit
 * notes): a request lacking any forwarding header came straight over the private
 * network (container healthcheck, internal monitoring), and a forwarded request
 * is internal only if its client IP is itself private/allow-listed.
 *
 * Uses the right-most XFF hop — the address the proxy observed and appended,
 * which a client cannot forge — so a public caller can't spoof a private source
 * IP to pass this gate. Assumes a single trusted proxy hop.
 */
export function isInternalRequest(request: NextRequest): boolean {
  const xff = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');

  if (!xff && !realIp) return true;

  const parts = xff?.split(',') ?? [];
  const clientIp = (parts[parts.length - 1]?.trim() || realIp?.trim() || '');
  if (!clientIp) return true;
  if (TRUSTED_INTERNAL_IPS.includes(clientIp)) return true;
  return isPrivateIp(clientIp);
}
