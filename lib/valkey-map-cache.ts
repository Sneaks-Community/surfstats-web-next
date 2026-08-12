import 'server-only';
import { cachedFetch, type RefreshOptions } from './cached-fetch';
import { fetchAllMapMetadata } from './map-cache';
import type { MapMetadata } from './map-cache';

const MAP_METADATA_KEY = 'surfstats:map:metadata';
const MAP_METADATA_TTL = 7200; // 2 hours, comfortably over the 30min refresh

/**
 * Get all map metadata from Valkey cache with request deduplication
 * Falls back to database if cache miss
 * Uses CacheLock to prevent cache stampede when multiple requests miss simultaneously
 *
 * The metadata Map is stored as a plain object for JSON serialization and
 * rehydrated on read.
 */
export async function getAllMapMetadataFromCache({ force }: RefreshOptions = {}): Promise<Map<string, MapMetadata>> {
  const stored = await cachedFetch(
    MAP_METADATA_KEY,
    MAP_METADATA_TTL,
    async () => Object.fromEntries(await fetchAllMapMetadata()),
    { lock: true, force }
  );

  return new Map(Object.entries(stored));
}

/**
 * Get metadata for a single map from Valkey cache
 */
export async function getMapMetadataFromCache(mapname: string): Promise<MapMetadata | null> {
  return cachedFetch(
    `surfstats:map:${mapname}`,
    MAP_METADATA_TTL,
    async () => (await getAllMapMetadataFromCache()).get(mapname) ?? null
  );
}

/**
 * Get tier distribution from Valkey cache.
 * Checks the tier distribution cache first, then falls back to deriving
 * from the cached full metadata (which handles its own caching/deduplication).
 *
 * The distribution Map is stored as a plain object for JSON serialization and
 * rehydrated on read.
 */
export async function getTierDistributionFromCache({ force }: RefreshOptions = {}): Promise<Map<number, number>> {
  const stored = await cachedFetch(
    `${MAP_METADATA_KEY}:tier_distribution`,
    MAP_METADATA_TTL,
    async () => {
      // Derive from the cached full metadata (which handles its own
      // caching/deduplication, avoiding nested lock issues).
      const metadata = await getAllMapMetadataFromCache();
      const distribution: Record<number, number> = {};
      for (const map of metadata.values()) {
        distribution[map.tier] = (distribution[map.tier] || 0) + 1;
      }
      return distribution;
    },
    { force }
  );

  return new Map(Object.entries(stored).map(([k, v]) => [Number(k), v]));
}
