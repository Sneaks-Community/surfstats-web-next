import 'server-only';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import logger from '@/lib/logger';

// Types for bonus and stage registries
export interface BonusGroup {
  mapname: string;
  zonegroup: number;
  wr_time: number | null;
}

export interface StageGroup {
  map: string;
  stage: number;
  count: number; // Number of completions for this stage (aggregated)
}

// Cache TTL: 1 hour (in milliseconds)
const REGISTRY_CACHE_TTL = 60 * 60 * 1000;

// Global cache structure
interface GlobalRegistryCache {
  bonuses: BonusGroup[];
  stages: StageGroup[];
  playerCount: number;
  lastUpdated: number;
  initialized: boolean;
  initialFetchPromise: Promise<void> | null;
}

// Get or create the global cache using globalThis for persistence across hot reloads
function getGlobalRegistryCache(): GlobalRegistryCache {
  const global = globalThis as unknown as { registryCache?: GlobalRegistryCache };
  if (!global.registryCache) {
    global.registryCache = {
      bonuses: [],
      stages: [],
      playerCount: 0,
      lastUpdated: 0,
      initialized: false,
      initialFetchPromise: null,
    };
  }
  return global.registryCache;
}

/**
 * Fetch all bonus groups, stages, and player count from database in parallel
 */
async function fetchRegistryData(): Promise<{ bonuses: BonusGroup[]; stages: StageGroup[]; playerCount: number }> {
  const startTime = Date.now();
  
  try {
    logger.debug('[RegistryCache] Fetching bonus/stage registry and player count from database...');
    
    // Run all three queries in parallel
    const [bonusResult, stageResult, countResult] = await Promise.all([
      pool.query<RowDataPacket[]>(`
        SELECT z.mapname, z.zonegroup, MIN(b.runtime) as wr_time
        FROM ck_zones z
        LEFT JOIN ck_bonus b ON z.mapname = b.mapname AND z.zonegroup = b.zonegroup
        WHERE z.zonegroup > 0
        GROUP BY z.mapname, z.zonegroup
        ORDER BY z.mapname ASC, z.zonegroup ASC
      `),
      pool.query<RowDataPacket[]>(`
        SELECT map, stage, COUNT(*) as count
        FROM ck_stages
        GROUP BY map, stage
        ORDER BY map ASC, stage ASC
      `),
      pool.query<RowDataPacket[]>(`
        SELECT COUNT(*) as total FROM ck_playerrank
      `),
    ]);
    
    const bonuses: BonusGroup[] = (bonusResult[0] as RowDataPacket[]).map((row) => ({
      mapname: row.mapname,
      zonegroup: row.zonegroup,
      wr_time: row.wr_time || null,
    }));
    
    const stages: StageGroup[] = (stageResult[0] as RowDataPacket[]).map((row) => ({
      map: row.map,
      stage: row.stage,
      count: row.count,
    }));
    
    const playerCount = (countResult[0] as RowDataPacket[])[0].total;
    
    const duration = Date.now() - startTime;
    logger.debug(`[RegistryCache] Fetched ${bonuses.length} bonus groups, ${stages.length} stages, and ${playerCount} players in ${duration}ms`);
    
    return { bonuses, stages, playerCount };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logger.error(`[RegistryCache] Failed to fetch registry data after ${duration}ms`);
    logger.error(`[RegistryCache] Error: ${error.message || 'Unknown error'}`);
    throw error;
  }
}

/**
 * Initialize the registry cache - called automatically on first access
 */
function initRegistryCache(): void {
  if (typeof window !== 'undefined') {
    // Skip in browser context
    return;
  }
  
  const cache = getGlobalRegistryCache();
  
  if (cache.initialized) {
    return;
  }
  
  cache.initialized = true;
  logger.info('[RegistryCache] Initializing bonus/stage registry cache (1 hour TTL)...');
  
  // Initial fetch - store promise so callers can await it
  cache.initialFetchPromise = fetchRegistryData()
    .then(({ bonuses, stages, playerCount }) => {
      cache.bonuses = bonuses;
      cache.stages = stages;
      cache.playerCount = playerCount;
      cache.lastUpdated = Date.now();
      logger.info(`[RegistryCache] Cache initialized with ${bonuses.length} bonuses, ${stages.length} stages, and ${playerCount} players`);
    })
    .catch((err) => {
      logger.error(`[RegistryCache] Initial fetch failed: ${err.message}`);
    });
}

/**
 * Get all bonus groups from cache
 */
export async function getAllBonusGroups(): Promise<BonusGroup[]> {
  // Initialize cache on first call (runs on server)
  if (typeof window === 'undefined') {
    initRegistryCache();
  }
  
  const cache = getGlobalRegistryCache();
  
  // Wait for initial fetch to complete before returning
  if (cache.initialFetchPromise) {
    await cache.initialFetchPromise;
    cache.initialFetchPromise = null;
  }
  
  // Check if cache is still valid
  const now = Date.now();
  if (now - cache.lastUpdated < REGISTRY_CACHE_TTL && cache.bonuses.length > 0) {
    logger.debug(`[RegistryCache] Cache hit: ${cache.bonuses.length} bonuses (age: ${Math.round((now - cache.lastUpdated) / 1000)}s)`);
    return cache.bonuses;
  }
  
  // Cache expired or empty - fetch fresh data
  logger.debug('[RegistryCache] Cache expired, fetching fresh data...');
  const { bonuses, stages, playerCount } = await fetchRegistryData();
  cache.bonuses = bonuses;
  cache.stages = stages;
  cache.playerCount = playerCount;
  cache.lastUpdated = now;
  
  return cache.bonuses;
}

/**
 * Get all stages from cache
 */
export async function getAllStages(): Promise<StageGroup[]> {
  // Initialize cache on first call (runs on server)
  if (typeof window === 'undefined') {
    initRegistryCache();
  }
  
  const cache = getGlobalRegistryCache();
  
  // Wait for initial fetch to complete before returning
  if (cache.initialFetchPromise) {
    await cache.initialFetchPromise;
    cache.initialFetchPromise = null;
  }
  
  // Check if cache is still valid
  const now = Date.now();
  if (now - cache.lastUpdated < REGISTRY_CACHE_TTL && cache.stages.length > 0) {
    logger.debug(`[RegistryCache] Cache hit: ${cache.stages.length} stages (age: ${Math.round((now - cache.lastUpdated) / 1000)}s)`);
    return cache.stages;
  }
  
  // Cache expired or empty - fetch fresh data
  logger.debug('[RegistryCache] Cache expired, fetching fresh data...');
  const { bonuses, stages, playerCount } = await fetchRegistryData();
  cache.bonuses = bonuses;
  cache.stages = stages;
  cache.playerCount = playerCount;
  cache.lastUpdated = now;
  
  return cache.stages;
}

/**
 * Get total player count from cache
 */
export async function getPlayerCount(): Promise<number> {
  // Initialize cache on first call (runs on server)
  if (typeof window === 'undefined') {
    initRegistryCache();
  }
  
  const cache = getGlobalRegistryCache();
  
  // Wait for initial fetch to complete before returning
  if (cache.initialFetchPromise) {
    await cache.initialFetchPromise;
    cache.initialFetchPromise = null;
  }
  
  // Check if cache is still valid
  const now = Date.now();
  if (now - cache.lastUpdated < REGISTRY_CACHE_TTL && cache.playerCount > 0) {
    logger.debug(`[RegistryCache] Cache hit: player count ${cache.playerCount} (age: ${Math.round((now - cache.lastUpdated) / 1000)}s)`);
    return cache.playerCount;
  }
  
  // Cache expired or empty - fetch fresh data
  logger.debug('[RegistryCache] Cache expired, fetching fresh data...');
  const { bonuses, stages, playerCount } = await fetchRegistryData();
  cache.bonuses = bonuses;
  cache.stages = stages;
  cache.playerCount = playerCount;
  cache.lastUpdated = now;
  
  return cache.playerCount;
}

/**
 * Get bonus groups for a specific map
 */
export async function getBonusGroupsForMap(mapname: string): Promise<BonusGroup[]> {
  const allBonuses = await getAllBonusGroups();
  return allBonuses.filter((b) => b.mapname === mapname);
}

/**
 * Get bonus group zone numbers for a specific map (returns array of zonegroup numbers)
 * This is a synchronous function that operates on the cached data
 */
export async function getBonusGroupsByMap(mapname: string): Promise<number[]> {
  const allBonuses = await getAllBonusGroups();
  return allBonuses
    .filter((b) => b.mapname === mapname)
    .map((b) => b.zonegroup)
    .sort((a, b) => a - b);
}

/**
 * Get stages for a specific map
 */
export async function getStagesForMap(mapname: string): Promise<StageGroup[]> {
  const allStages = await getAllStages();
  return allStages.filter((s) => s.map === mapname);
}

/**
 * Get incomplete maps for a player (maps that exist but player hasn't completed)
 * Uses the map cache for map names and player's finished maps from database
 */
export async function getIncompleteMapsForPlayer(
  steamid: string,
  finishedMapNames: Set<string>
): Promise<{ mapname: string; tier: number; wr_time: number | null }[]> {
  // Import here to avoid circular dependency
  const { getAllMapMetadata } = await import('./map-cache');
  
  const allMetadata = await getAllMapMetadata();
  const incompleteMaps: { mapname: string; tier: number; wr_time: number | null }[] = [];
  
  for (const [mapname, metadata] of allMetadata) {
    if (!finishedMapNames.has(mapname)) {
      incompleteMaps.push({
        mapname,
        tier: metadata.tier,
        wr_time: metadata.wr_time,
      });
    }
  }
  
  // Sort by tier then name
  return incompleteMaps.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.mapname.localeCompare(b.mapname);
  });
}

/**
 * Get incomplete bonus groups for a player
 */
export async function getIncompleteBonusesForPlayer(
  finishedBonusKeys: Set<string>
): Promise<BonusGroup[]> {
  const allBonuses = await getAllBonusGroups();
  return allBonuses.filter((b) => !finishedBonusKeys.has(`${b.mapname}:${b.zonegroup}`));
}

/**
 * Get incomplete stages for a player
 */
export async function getIncompleteStagesForPlayer(
  finishedStageKeys: Set<string>
): Promise<StageGroup[]> {
  const allStages = await getAllStages();
  return allStages.filter((s) => !finishedStageKeys.has(`${s.map}:${s.stage}`));
}

/**
 * Get cache stats for debugging/monitoring
 */
export function getRegistryCacheStats(): {
  lastUpdated: number;
  ageSeconds: number;
  initialized: boolean;
  bonusCount: number;
  stageCount: number;
  playerCount: number;
} {
  const cache = getGlobalRegistryCache();
  return {
    lastUpdated: cache.lastUpdated,
    ageSeconds: cache.lastUpdated ? Math.round((Date.now() - cache.lastUpdated) / 1000) : -1,
    initialized: cache.initialized,
    bonusCount: cache.bonuses.length,
    stageCount: cache.stages.length,
    playerCount: cache.playerCount,
  };
}

/**
 * Force refresh the cache (useful for admin operations)
 */
export async function refreshRegistryCache(): Promise<void> {
  const cache = getGlobalRegistryCache();
  logger.info('[RegistryCache] Force refreshing cache...');
  
  const { bonuses, stages, playerCount } = await fetchRegistryData();
  cache.bonuses = bonuses;
  cache.stages = stages;
  cache.playerCount = playerCount;
  cache.lastUpdated = Date.now();
  
  logger.info(`[RegistryCache] Cache refreshed with ${bonuses.length} bonuses, ${stages.length} stages, and ${playerCount} players`);
}