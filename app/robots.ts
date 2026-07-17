import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/site-url';

/**
 * robots.txt — allow crawling the rendered pages, but disallow the JSON API so
 * crawlers index the pages and never hit `/api/*` (which the origin guard would
 * 403 anyway). Points at the sitemap of static + map pages.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await getSiteUrl();
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/api/',
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
