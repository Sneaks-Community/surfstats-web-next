import 'server-only';
import { headers } from 'next/headers';

/**
 * Resolve the site's canonical base URL (no trailing slash) for absolute links
 * in robots.txt / sitemap.xml.
 *
 * `NEXT_PUBLIC_SITE_URL` is required at boot, so the header-derived origin below
 * only applies to `next build` (where env validation is skipped) and to a
 * misconfigured server; those headers are spoofable, hence not the normal path.
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
