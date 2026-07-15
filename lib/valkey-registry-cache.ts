import 'server-only';
import { cachedFetch } from './cached-fetch';
import { fetchRegistryData } from './registry-cache';
import type { BonusGroup, StageGroup } from './registry-cache';

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
  return cachedFetch(REGISTRY_DATA_KEY, REGISTRY_CACHE_TTL, fetchRegistryData, { lock: true });
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
