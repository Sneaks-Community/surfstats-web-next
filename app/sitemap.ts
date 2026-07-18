import type { MetadataRoute } from 'next';
import { getAllMapMetadataFromCache } from '@/lib/valkey-map-cache';
import { getSiteUrl } from '@/lib/site-url';
import { getErrorMessage } from '@/lib/errors';
import logger from '@/lib/logger';

/**
 * Sitemap of the site's static pages plus every map page (map list comes from
 * the already-cached map metadata, so this stays cheap).
 *
 * Individual player profiles are intentionally NOT enumerated: they're
 * crawlable via `/players`, but listing every one would require a full-table
 * scan and a very large sitemap — deliberately out of scope here.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await getSiteUrl();
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/maps`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/players`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/servers`, lastModified: now, changeFrequency: 'hourly', priority: 0.7 },
    { url: `${base}/players/countries`, lastModified: now, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${base}/players/countries/list`, lastModified: now, changeFrequency: 'weekly', priority: 0.4 },
    { url: `${base}/search`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
  ];

  let mapRoutes: MetadataRoute.Sitemap = [];
  try {
    const metadata = await getAllMapMetadataFromCache();
    mapRoutes = Array.from(metadata.keys()).map((mapname) => ({
      url: `${base}/maps/${encodeURIComponent(mapname)}`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.8,
    }));
  } catch (error: unknown) {
    // Don't fail the whole sitemap if the map list is briefly unavailable.
    logger.error(`[sitemap] Failed to list map pages: ${getErrorMessage(error)}`);
  }

  return [...staticRoutes, ...mapRoutes];
}
