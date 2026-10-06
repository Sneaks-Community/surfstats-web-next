import 'server-only';
import { headers } from 'next/headers';

/**
 * Canonical base URL (no trailing slash) for robots.txt and sitemap.xml links. The spoofable
 * header fallback only runs at build (env unvalidated) or on a misconfigured server.
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
