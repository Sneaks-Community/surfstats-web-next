import 'server-only';
import { cacheGet, cacheSet, cacheInvalidatePattern } from './valkey-cache';
import { getAllBonusGroups, getAllStages, getPlayerCount } from './registry-cache';
import type { BonusGroup, StageGroup } from './registry-cache';

const BONUS_REGISTRY_KEY = 'surfstats:registry:bonuses';
const STAGE_REGISTRY_KEY = 'surfstats:registry:stages';
const PLAYER_COUNT_KEY = 'surfstats:registry:playercount';
const REGISTRY_CACHE_TTL = 3600; // 1 hour

/**
 * Get all bonus groups from cache
 */
export async function getAllBonusGroupsFromCache(): Promise<BonusGroup[]> {
  const cached = await cacheGet<BonusGroup[]>(BONUS_REGISTRY_KEY);

  if (cached) {
    return cached;
  }

  // Fetch from database
  const bonuses = await getAllBonusGroups();

  // Cache the result
  await cacheSet(BONUS_REGISTRY_KEY, bonuses, REGISTRY_CACHE_TTL);

  return bonuses;
}

/**
 * Get all stages from cache
 */
export async function getAllStagesFromCache(): Promise<StageGroup[]> {
  const cached = await cacheGet<StageGroup[]>(STAGE_REGISTRY_KEY);

  if (cached) {
    return cached;
  }

  // Fetch from database
  const stages = await getAllStages();

  // Cache the result
  await cacheSet(STAGE_REGISTRY_KEY, stages, REGISTRY_CACHE_TTL);

  return stages;
}

/**
 * Get player count from cache
 */
export async function getPlayerCountFromCache(): Promise<number> {
  const cached = await cacheGet<number>(PLAYER_COUNT_KEY);

  if (cached !== null) {
    return cached;
  }

  // Fetch from database
  const playerCount = await getPlayerCount();

  // Cache the result
  await cacheSet(PLAYER_COUNT_KEY, playerCount, REGISTRY_CACHE_TTL);

  return playerCount;
}

/**
 * Invalidate registry cache
 */
export async function invalidateRegistryCache(): Promise<void> {
  await cacheInvalidatePattern('surfstats:registry:*');
}
