import 'server-only';
import type { NextRequest } from 'next/server';

// Extra origins (comma-separated) allowed to call the API, e.g. a separate
// front-end. The site's own origin is always allowed.
const ALLOWED_ORIGINS: readonly string[] = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// The site's own origin, from the required NEXT_PUBLIC_SITE_URL. Never derived
// from Host / X-Forwarded-Host: those are client-spoofable, so a header-derived
// own-origin would let any caller name itself as trusted.
const CONFIGURED_ORIGIN: string | null = (() => {
  const url = process.env.NEXT_PUBLIC_SITE_URL;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
})();

/** Origin implied by the request's Origin or Referer header, if any. */
function sourceOrigin(request: NextRequest): string | null {
  const origin = request.headers.get('origin');
  if (origin) return origin;
  const referer = request.headers.get('referer');
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/**
 * Whether an API request originates from the site itself (or an allow-listed
 * origin). Trusts the browser-set `Sec-Fetch-Site: same-origin` signal (which
 * page JS cannot forge), falling back to an Origin/Referer allowlist for clients
 * that omit it. Not a hard boundary: a non-browser client can spoof these
 * headers — it blocks cross-origin embedding and naive scraping, not everything.
 */
export function isTrustedRequest(request: NextRequest): boolean {
  const trusted = new Set(ALLOWED_ORIGINS);
  if (CONFIGURED_ORIGIN) trusted.add(CONFIGURED_ORIGIN);

  // Explicit Origin/Referer match wins, so a configured external front-end works
  // even when the browser reports the request as cross-site.
  const src = sourceOrigin(request);
  if (src && trusted.has(src)) return true;

  // Same-origin fetches (our relative `/api/...` calls) often omit Origin but
  // always carry this header in modern browsers.
  const secFetchSite = request.headers.get('sec-fetch-site');
  if (secFetchSite) return secFetchSite === 'same-origin';

  // No Sec-Fetch metadata and no matching Origin/Referer (e.g. bare curl).
  return false;
}
