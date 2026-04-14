import 'server-only';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import logger from '@/lib/logger';
import { withTimeout } from '@/lib/timeout';

// Types for map metadata
export interface MapMetadata {
  mapname: string;
  tier: number;
  mapper: string;
  mappersteam: string | null;
  bonuses: number;
  stages: number;
  checkpoints: number;
  completions: number;
  wr_time: number | null;
  wr_holder: string | null;
  wr_holder_steamid: string | null;
}

// Configuration constants
const QUERY_TIMEOUT_MS = 30000; // 30 seconds - prevents indefinite query hanging
const CACHE_REFRESH_INTERVAL = 60 * 60 * 1000; // 1 hour - background refresh interval

// Global cache structure with background refresh support
interface GlobalMapCache {
  data: Map<string, MapMetadata>;
  lastUpdated: number;
  initialized: boolean;
  initialFetchPromise: Promise<void> | null;
  refreshIntervalId: NodeJS.Timeout | null;
}

// Get or create the global cache using globalThis for persistence across hot reloads
function getGlobalMapCache(): GlobalMapCache {
  const global = globalThis as unknown as { mapMetadataCache?: GlobalMapCache };
  if (!global.mapMetadataCache) {
    global.mapMetadataCache = {
      data: new Map(),
      lastUpdated: 0,
      initialized: false,
      initialFetchPromise: null,
      refreshIntervalId: null,
    };
  }
  return global.mapMetadataCache;
}

/**
 * Fetch all map metadata from database in a single optimized query
 * Uses JOINs instead of correlated subqueries for better performance
 * Includes timeout protection to prevent indefinite query hanging
 */
async function fetchAllMapMetadata(): Promise<Map<string, MapMetadata>> {
  const startTime = Date.now();
  
  try {
    logger.debug('[MapCache] Fetching all map metadata from database...');
    
    // Single query with JOINs - much more efficient than multiple queries or correlated subqueries
    const [rows] = await withTimeout(
      pool.query<RowDataPacket[]>(`
        SELECT
          m.mapname,
          m.tier,
          m.mapper,
          m.mappersteam,
          COALESCE(pt_cnt.completions, 0) as completions,
          COALESCE(b_cnt.bonus_count, 0) as bonuses,
          COALESCE(s_cnt.stage_count, 0) as stages,
          COALESCE(c_cnt.checkpoint_count, 0) as checkpoints,
          wr.min_runtime as wr_time,
          wr_holder.name as wr_holder,
          wr_holder.steamid as wr_holder_steamid
        FROM ck_maptier m
        LEFT JOIN (
          SELECT mapname, COUNT(*) as completions
          FROM ck_playertimes
          GROUP BY mapname
        ) pt_cnt ON m.mapname = pt_cnt.mapname
        LEFT JOIN (
          SELECT mapname, COUNT(DISTINCT zonegroup) as bonus_count
          FROM ck_zones
          WHERE zonegroup > 0
          GROUP BY mapname
        ) b_cnt ON m.mapname = b_cnt.mapname
        LEFT JOIN (
          SELECT mapname, COUNT(*) + 1 as stage_count
          FROM ck_zones
          WHERE zonetype = 3
          GROUP BY mapname
        ) s_cnt ON m.mapname = s_cnt.mapname
        LEFT JOIN (
          SELECT mapname, COUNT(*) as checkpoint_count
          FROM ck_zones
          WHERE zonetype = 4
          GROUP BY mapname
        ) c_cnt ON m.mapname = c_cnt.mapname
        LEFT JOIN (
          SELECT mapname, MIN(runtimepro) as min_runtime
          FROM ck_playertimes
          GROUP BY mapname
        ) wr ON m.mapname = wr.mapname
        LEFT JOIN ck_playertimes wr_holder
          ON wr.mapname = wr_holder.mapname
          AND wr.min_runtime = wr_holder.runtimepro
        WHERE pt_cnt.completions > 0
        ORDER BY m.mapname ASC
      `),
      QUERY_TIMEOUT_MS,
      'Query timeout exceeded'
    );
    
    const metadataMap = new Map<string, MapMetadata>();
    
    for (const row of rows) {
      metadataMap.set(row.mapname, {
        mapname: row.mapname,
        tier: row.tier,
        mapper: row.mapper,
        mappersteam: row.mappersteam,
        bonuses: row.bonuses || 0,
        stages: row.stages || 0,
        checkpoints: row.checkpoints || 0,
        completions: row.completions || 0,
        wr_time: row.wr_time,
        wr_holder: row.wr_holder,
        wr_holder_steamid: row.wr_holder_steamid,
      });
    }
    
    const duration = Date.now() - startTime;
    logger.debug(`[MapCache] Fetched ${metadataMap.size} maps in ${duration}ms`);
    
    // Debug: Log first map's checkpoints value
    const firstMap = metadataMap.values().next().value;
    if (firstMap) {
      logger.debug(`[MapCache] Sample map: ${firstMap.mapname} - stages: ${firstMap.stages}, checkpoints: ${firstMap.checkpoints}`);
    }
    
    return metadataMap;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    // Handle timeout specifically
    if (error.message === 'Query timeout exceeded') {
      logger.error(`[MapCache] Query timeout after ${duration}ms`);
      throw new Error(`Map metadata query exceeded ${QUERY_TIMEOUT_MS / 1000} second timeout`);
    }
    
    logger.error(`[MapCache] Failed to fetch map metadata after ${duration}ms`);
    logger.error(`[MapCache] Error: ${error.message || 'Unknown error'}`);
    throw error;
  }
}

/**
 * Refresh the map cache in the background
 * Returns a promise that resolves when the refresh completes
 */
async function refreshMapCacheBackground(): Promise<void> {
  const cache = getGlobalMapCache();
  
  try {
    logger.debug('[MapCache] Background refresh started...');
    const freshData = await fetchAllMapMetadata();
    cache.data = freshData;
    cache.lastUpdated = Date.now();
    logger.info(`[MapCache] Background refresh complete: ${freshData.size} maps`);
  } catch (error: any) {
    logger.error(`[MapCache] Background refresh failed: ${error.message}`);
    // Don't throw - background refresh failures shouldn't block user requests
  }
}

/**
 * Initialize the map cache with background refresh
 * Called automatically on first access
 */
function initMapCache(): void {
  if (typeof window !== 'undefined') {
    // Skip in browser context
    return;
  }
  
  const cache = getGlobalMapCache();
  
  if (cache.initialized) {
    return;
  }
  
  cache.initialized = true;
  logger.info('[MapCache] Initializing map metadata cache with background refresh...');
  
  // Initial fetch - store promise so callers can await it
  cache.initialFetchPromise = refreshMapCacheBackground();
  
  // Start background refresh interval
  cache.refreshIntervalId = setInterval(() => {
    refreshMapCacheBackground().catch((err) => {
      logger.error(`[MapCache] Background refresh error: ${err.message}`);
    });
  }, CACHE_REFRESH_INTERVAL);
  
  logger.info(`[MapCache] Background refresh scheduled every ${CACHE_REFRESH_INTERVAL / 1000} seconds`);
}

/**
 * Get all map metadata from cache
 * Returns cached data immediately - background refresh handles updates
 */
export async function getAllMapMetadata(): Promise<Map<string, MapMetadata>> {
  // Initialize cache on first call (runs on server)
  if (typeof window === 'undefined') {
    initMapCache();
  }
  
  const cache = getGlobalMapCache();
  
  // Wait for initial fetch to complete before returning
  if (cache.initialFetchPromise) {
    await cache.initialFetchPromise;
  }
  
  // Always return cached data - background refresh handles updates
  // This prevents blocking user requests on slow queries
  return cache.data;
}

/**
 * Get metadata for a single map
 */
export async function getMapMetadata(mapname: string): Promise<MapMetadata | null> {
  const allMetadata = await getAllMapMetadata();
  return allMetadata.get(mapname) || null;
}

/**
 * Get all map names as an array
 */
export async function getMapNames(): Promise<string[]> {
  const allMetadata = await getAllMapMetadata();
  return Array.from(allMetadata.keys());
}

/**
 * Get total number of maps
 */
export async function getTotalMapCount(): Promise<number> {
  const allMetadata = await getAllMapMetadata();
  return allMetadata.size;
}

/**
 * Get total number of bonuses across all maps
 */
export async function getTotalBonusCount(): Promise<number> {
  const allMetadata = await getAllMapMetadata();
  let total = 0;
  for (const map of allMetadata.values()) {
    total += map.bonuses || 0;
  }
  return total;
}

/**
 * Get total number of stages across all maps
 */
export async function getTotalStageCount(): Promise<number> {
  const allMetadata = await getAllMapMetadata();
  let total = 0;
  for (const map of allMetadata.values()) {
    total += map.stages || 0;
  }
  return total;
}

/**
 * Get totals for progress bars (maps, bonuses, stages)
 */
export async function getTotals(): Promise<{
  totalMaps: number;
  totalBonuses: number;
  totalStages: number;
}> {
  const allMetadata = await getAllMapMetadata();
  
  let totalBonuses = 0;
  let totalStages = 0;
  
  for (const map of allMetadata.values()) {
    totalBonuses += map.bonuses || 0;
    totalStages += map.stages || 0;
  }
  
  return {
    totalMaps: allMetadata.size,
    totalBonuses,
    totalStages,
  };
}

/**
 * Get maps filtered by tier
 */
export async function getMapsByTier(tier: number): Promise<MapMetadata[]> {
  const allMetadata = await getAllMapMetadata();
  const maps: MapMetadata[] = [];
  
  for (const map of allMetadata.values()) {
    if (map.tier === tier) {
      maps.push(map);
    }
  }
  
  return maps.sort((a, b) => a.mapname.localeCompare(b.mapname));
}

/**
 * Get tier distribution (count of maps per tier)
 */
export async function getTierDistribution(): Promise<Map<number, number>> {
  const allMetadata = await getAllMapMetadata();
  const distribution = new Map<number, number>();
  
  for (const map of allMetadata.values()) {
    const count = distribution.get(map.tier) || 0;
    distribution.set(map.tier, count + 1);
  }
  
  return distribution;
}

/**
 * Get tier distribution with linear vs staged map counts per tier
 * Linear maps: maps with 0 stages (bonuses only or no bonus/stage)
 * Staged maps: maps with >0 stages
 */
export async function getTierDistributionWithStages(): Promise<Map<number, { linear: number; staged: number }>> {
  const allMetadata = await getAllMapMetadata();
  const distribution = new Map<number, { linear: number; staged: number }>();
  
  for (const map of allMetadata.values()) {
    const tier = map.tier;
    const stages = map.stages || 0;
    const counts = distribution.get(tier) || { linear: 0, staged: 0 };
    
    if (stages === 0) {
      // Linear map (no stages)
      counts.linear++;
    } else {
      // Staged map (has stages)
      counts.staged++;
    }
    
    distribution.set(tier, counts);
  }
  
  return distribution;
}

/**
 * Get cache stats for debugging/monitoring
 */
export function getMapCacheStats(): {
  lastUpdated: number;
  ageSeconds: number;
  initialized: boolean;
  mapCount: number;
} {
  const cache = getGlobalMapCache();
  return {
    lastUpdated: cache.lastUpdated,
    ageSeconds: cache.lastUpdated ? Math.round((Date.now() - cache.lastUpdated) / 1000) : -1,
    initialized: cache.initialized,
    mapCount: cache.data.size,
  };
}

/**
 * Force refresh the cache (useful for admin operations)
 * This performs a synchronous refresh and returns a promise that resolves when complete
 */
export async function refreshMapCache(): Promise<void> {
  const cache = getGlobalMapCache();
  logger.info('[MapCache] Force refreshing cache...');
  
  const freshData = await fetchAllMapMetadata();
  cache.data = freshData;
  cache.lastUpdated = Date.now();
  
  logger.info(`[MapCache] Cache refreshed with ${freshData.size} maps`);
}

/**
 * Cleanup function to stop background refresh interval
 * Call this on server shutdown
 */
export function cleanupMapCache(): void {
  const cache = getGlobalMapCache();
  
  if (cache.refreshIntervalId) {
    clearInterval(cache.refreshIntervalId);
    cache.refreshIntervalId = null;
    logger.info('[MapCache] Background refresh interval cleared');
  }
}