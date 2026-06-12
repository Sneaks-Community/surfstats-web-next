import 'server-only';
import { cacheGet, cacheSet } from './valkey-cache';
import { fetchRegistryData } from './registry-cache';
import type { BonusGroup, StageGroup } from './registry-cache';
import { cacheLock, shouldExpireEarly } from './cache-lock';
import logger from './logger';

const REGISTRY_DATA_KEY = 'surfstats:registry:data';
const REGISTRY_CACHE_TTL = 3600; // 1 hour

/**
 * Get all registry data (bonuses, stages, player count) from Valkey cache with request deduplication
 * Falls back to database if cache miss
 * Uses CacheLock to prevent cache stampede when multiple requests miss simultaneously
 */
export async function getAllRegistryDataFromCache(): Promise<{
  bonuses: BonusGroup[];
  stages: StageGroup[];
  playerCount: number;
}> {
  const cached = await cacheGet<{
    bonuses: BonusGroup[];
    stages: StageGroup[];
    playerCount: number;
  }>(REGISTRY_DATA_KEY);

  if (cached) {
    logger.debug('[RegistryCache] Valkey cache hit for registry data');
    return cached;
  }

  // Probabilistic early expiration to prevent synchronized cache expiration
  if (shouldExpireEarly(0.1)) {
    logger.debug('[RegistryCache] Early expiration triggered for registry data');
  }

  // Use cache lock to prevent concurrent database queries
  return cacheLock.acquire(REGISTRY_DATA_KEY, async () => {
    // Double-check cache after acquiring lock
    const rechecked = await cacheGet<{
      bonuses: BonusGroup[];
      stages: StageGroup[];
      playerCount: number;
    }>(REGISTRY_DATA_KEY);
    if (rechecked) {
      logger.debug('[RegistryCache] Cache hit after lock acquisition');
      return rechecked;
    }

    logger.debug('[RegistryCache] Cache miss, fetching from database...');

    // Fetch from database
    const data = await fetchRegistryData();

    // Cache the result
    await cacheSet(REGISTRY_DATA_KEY, data, REGISTRY_CACHE_TTL);

    logger.debug(`[RegistryCache] Cached ${data.bonuses.length} bonuses, ${data.stages.length} stages, ${data.playerCount} players`);

    return data;
  });
}

/**
 * Get all bonus groups from Valkey cache
 */
export async function getAllBonusGroupsFromCache(): Promise<BonusGroup[]> {
  const data = await getAllRegistryDataFromCache();
  return data.bonuses;
}

/**
 * Get all stages from Valkey cache
 */
export async function getAllStagesFromCache(): Promise<StageGroup[]> {
  const data = await getAllRegistryDataFromCache();
  return data.stages;
}

/**
 * Get player count from Valkey cache
 */
export async function getPlayerCountFromCache(): Promise<number> {
  const data = await getAllRegistryDataFromCache();
  return data.playerCount;
}

/**
 * Get bonus groups for a specific map from Valkey cache
 */
export async function getBonusGroupsByMapFromCache(mapname: string): Promise<number[]> {
  const data = await getAllRegistryDataFromCache();
  return data.bonuses
    .filter((b) => b.mapname === mapname)
    .map((b) => b.zonegroup)
    .sort((a, b) => a - b);
}

/**
 * Get stage numbers for a specific map from Valkey cache
 */
export async function getStagesByMapFromCache(mapname: string): Promise<number[]> {
  const data = await getAllRegistryDataFromCache();
  return data.stages
    .filter((s) => s.map === mapname)
    .map((s) => s.stage)
    .sort((a, b) => a - b);
}
