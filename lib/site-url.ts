import 'server-only';
import { headers } from 'next/headers';

/**
 * Resolve the site's canonical base URL (no trailing slash) for absolute links
 * in robots.txt / sitemap.xml.
 *
 * Prefers the explicit `NEXT_PUBLIC_SITE_URL` env var; otherwise derives the
 * origin from the incoming request headers (honoring the reverse proxy's
 * `x-forwarded-*`), so a default deployment works without extra config.
 */
export async function getSiteUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, '');

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto =
    h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
