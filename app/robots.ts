import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/site-url';

/**
 * robots.txt — allow crawling the rendered pages, but disallow the JSON API so
 * crawlers index the pages and never hit `/api/*` (which the origin guard would
 * 403 anyway). Points at the sitemap of static + map pages.
 *
 * Any query string is disallowed too: cache keys embed `page`/`sort`/`order`/`q`,
 * so a crawler walking those combinations is exactly the uncached heavy-query
 * space the rate limiter exists to bound. The sitemap still lists every
 * canonical page, so nothing indexable is lost.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await getSiteUrl();
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/*?'],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
