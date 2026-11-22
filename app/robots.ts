import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/site-url';

// allow crawling the rendered pages, but disallow the JSON API to crawlers
export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await getSiteUrl();
  return {
    rules: {
      userAgent: '*',
      // Longest match wins, so this beats `/*?`; filters precede `page`, so filtered views stay blocked.
      allow: ['/', '/maps?page='],
      disallow: ['/api/', '/*?'],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
