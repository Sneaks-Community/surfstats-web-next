import type { MetadataRoute } from 'next';
import { getAllMapMetadataFromCache } from '@/lib/map-cache';
import { getSiteUrl } from '@/lib/site-url';
import { getErrorMessage } from '@/lib/errors';
import logger from '@/lib/logger';

// Per request: at build time the map list would freeze to the build's cache (usually empty).
export const dynamic = 'force-dynamic';

/** Static pages plus every map page (cached metadata, so cheap). Player profiles are left out: they're
 * not a search target, and listing them all needs a full-table scan. No lastmod: there's no real one. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await getSiteUrl();
  const staticRoutes: MetadataRoute.Sitemap = ['/', '/maps', '/players', '/servers', '/players/countries', '/players/countries/list']
    .map((path) => ({ url: `${base}${path}` }));

  let mapRoutes: MetadataRoute.Sitemap = [];
  try {
    const metadata = await getAllMapMetadataFromCache();
    mapRoutes = Array.from(metadata.keys()).map((mapname) => ({ url: `${base}/maps/${encodeURIComponent(mapname)}` }));
  } catch (error: unknown) {
    // Don't fail the whole sitemap if the map list is briefly unavailable.
    logger.error(`[sitemap] Failed to list map pages: ${getErrorMessage(error)}`);
  }

  return [...staticRoutes, ...mapRoutes];
}
