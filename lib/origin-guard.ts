import 'server-only';
import type { NextRequest } from 'next/server';
import { getEnv } from './env';

// Extra origins allowed to call the API (e.g. a separate front-end); the site's own always is.
const ALLOWED_ORIGINS: readonly string[] = getEnv().ALLOWED_ORIGINS;

// The site's own origin. Never derived from Host / X-Forwarded-Host: those are
// client-spoofable, so any caller could name itself as trusted.
const CONFIGURED_ORIGIN: string | null = (() => {
  const url = process.env.NEXT_PUBLIC_SITE_URL;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
})();

/** Origin from the Origin header, else the Referer. */
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
 * Whether an API request comes from the site or an allow-listed origin. Not a hard boundary:
 * non-browser clients can spoof these headers; it stops cross-origin embedding and naive scraping.
 */
export function isTrustedRequest(request: NextRequest): boolean {
  const trusted = new Set(ALLOWED_ORIGINS);
  if (CONFIGURED_ORIGIN) trusted.add(CONFIGURED_ORIGIN);

  // Checked first so an allow-listed external front-end works despite Sec-Fetch-Site: cross-site.
  const src = sourceOrigin(request);
  if (src && trusted.has(src)) return true;

  // Page JS cannot forge this; same-origin fetches often omit Origin but always send it.
  const secFetchSite = request.headers.get('sec-fetch-site');
  if (secFetchSite) return secFetchSite === 'same-origin';

  // e.g. bare curl: no Sec-Fetch metadata and no matching Origin/Referer.
  return false;
}
