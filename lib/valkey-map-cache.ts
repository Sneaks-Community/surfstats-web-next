import 'server-only';
import { cacheGet, cacheSet, cacheInvalidatePattern } from './valkey-cache';
import { fetchAllMapMetadata, getTotals as getMapTotals } from './map-cache';
import type { MapMetadata } from './map-cache';
import { cacheLock, shouldExpireEarly } from './cache-lock';
import logger from './logger';

const MAP_METADATA_KEY = 'surfstats:map:metadata';
const MAP_METADATA_TTL = 3600; // 1 hour

/**
 * Get all map metadata from Valkey cache with request deduplication
 * Falls back to database if cache miss
 * Uses CacheLock to prevent cache stampede when multiple requests miss simultaneously
 */
export async function getAllMapMetadataFromCache(): Promise<Map<string, MapMetadata>> {
  const cached = await cacheGet<Map<string, MapMetadata>>(MAP_METADATA_KEY);

  if (cached) {
    logger.debug('[MapCache] Valkey cache hit for metadata');
    return new Map(Object.entries(cached));
  }

  // Probabilistic early expiration to prevent synchronized cache expiration
  if (shouldExpireEarly(0.1)) {
    logger.debug('[MapCache] Early expiration triggered for metadata');
  }

  // Use cache lock to prevent concurrent database queries
  return cacheLock.acquire(MAP_METADATA_KEY, async () => {
    // Double-check cache after acquiring lock
    const rechecked = await cacheGet<Map<string, MapMetadata>>(MAP_METADATA_KEY);
    if (rechecked) {
      logger.debug('[MapCache] Cache hit after lock acquisition');
      return new Map(Object.entries(rechecked));
    }

    logger.debug('[MapCache] Cache miss, fetching from database...');

    // Fetch from database
    const metadata = await fetchAllMapMetadata();

    // Cache the result
    await cacheSet(MAP_METADATA_KEY, Object.fromEntries(metadata), MAP_METADATA_TTL);

    logger.debug(`[MapCache] Cached ${metadata.size} maps with TTL ${MAP_METADATA_TTL}s`);

    return metadata;
  });
}

/**
 * Get metadata for a single map from Valkey cache
 */
export async function getMapMetadataFromCache(mapname: string): Promise<MapMetadata | null> {
  const key = `surfstats:map:${mapname}`;
  const cached = await cacheGet<MapMetadata>(key);

  if (cached) {
    return cached;
  }

  // Fetch from database via getAllMapMetadataFromCache
  const allMetadata = await getAllMapMetadataFromCache();
  const metadata = allMetadata.get(mapname) || null;

  if (metadata) {
    await cacheSet(key, metadata, MAP_METADATA_TTL);
  }

  return metadata;
}

/**
 * Get totals (maps, bonuses, stages) from Valkey cache
 */
export async function getTotalsFromMapCache(): Promise<{
  totalMaps: number;
  totalBonuses: number;
  totalStages: number;
}> {
  const cached = await cacheGet<{
    totalMaps: number;
    totalBonuses: number;
    totalStages: number;
  }>(`${MAP_METADATA_KEY}:totals`);

  if (cached) {
    return cached;
  }

  const totals = await getMapTotals();
  await cacheSet(`${MAP_METADATA_KEY}:totals`, totals, MAP_METADATA_TTL);

  return totals;
}

/**
 * Get tier distribution from Valkey cache.
 * Checks the tier distribution cache first, then falls back to deriving
 * from the cached full metadata (which handles its own caching/deduplication).
 */
export async function getTierDistributionFromCache(): Promise<Map<number, number>> {
  // Check tier distribution cache first
  const cached = await cacheGet<Record<number, number>>(`${MAP_METADATA_KEY}:tier_distribution`);
  if (cached) {
    logger.debug('[MapCache] Valkey cache hit for tier distribution');
    return new Map(Object.entries(cached).map(([k, v]) => [Number(k), v]));
  }

  // Cache miss - derive from the cached full metadata
  // (metadata handles its own caching/deduplication, avoiding nested lock issues)
  logger.debug('[MapCache] Cache miss for tier distribution, deriving from metadata...');
  const metadata = await getAllMapMetadataFromCache();
  const distribution = new Map<number, number>();
  for (const map of metadata.values()) {
    const count = distribution.get(map.tier) || 0;
    distribution.set(map.tier, count + 1);
  }

  // Cache the derived distribution for future calls (convert Map to plain object for JSON serialization)
  await cacheSet(`${MAP_METADATA_KEY}:tier_distribution`, Object.fromEntries(distribution), MAP_METADATA_TTL);

  return distribution;
}

/**
 * Invalidate map cache
 */
export async function invalidateMapCache(): Promise<void> {
  await cacheInvalidatePattern('surfstats:map:*');
}
