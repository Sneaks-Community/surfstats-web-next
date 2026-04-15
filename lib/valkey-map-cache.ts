import 'server-only';
import { cacheGet, cacheSet, cacheInvalidatePattern } from './valkey-cache';
import { getAllMapMetadata } from './map-cache';
import type { MapMetadata } from './map-cache';

const MAP_METADATA_KEY = 'surfstats:map:metadata';
const MAP_METADATA_TTL = 3600; // 1 hour

/**
 * Get all map metadata from cache
 */
export async function getAllMapMetadataFromCache(): Promise<Map<string, MapMetadata>> {
  const cached = await cacheGet<Map<string, MapMetadata>>(MAP_METADATA_KEY);

  if (cached) {
    return new Map(Object.entries(cached));
  }

  // Fetch from database
  const metadata = await getAllMapMetadata();

  // Cache the result
  await cacheSet(MAP_METADATA_KEY, Object.fromEntries(metadata), MAP_METADATA_TTL);

  return metadata;
}

/**
 * Get metadata for a single map from cache
 */
export async function getMapMetadataFromCache(mapname: string): Promise<MapMetadata | null> {
  const key = `surfstats:map:${mapname}`;
  return cacheGet<MapMetadata>(key);
}

/**
 * Invalidate map cache
 */
export async function invalidateMapCache(): Promise<void> {
  await cacheInvalidatePattern('surfstats:map:*');
}
