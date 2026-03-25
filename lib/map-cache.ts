import 'server-only';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import logger from '@/lib/logger';

// Types for map metadata
export interface MapMetadata {
  mapname: string;
  tier: number;
  mapper: string;
  mappersteam: string | null;
  bonuses: number;
  stages: number;
  completions: number;
  wr_time: number | null;
  wr_holder: string | null;
  wr_holder_steamid: string | null;
}

// Cache TTL: 1 hour (in milliseconds)
const MAP_CACHE_TTL = 60 * 60 * 1000;

// Global cache structure
interface GlobalMapCache {
  data: Map<string, MapMetadata>;
  lastUpdated: number;
  initialized: boolean;
  initialFetchPromise: Promise<void> | null;
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
    };
  }
  return global.mapMetadataCache;
}

/**
 * Fetch all map metadata from database in a single optimized query
 * Uses JOINs instead of correlated subqueries for better performance
 */
async function fetchAllMapMetadata(): Promise<Map<string, MapMetadata>> {
  const startTime = Date.now();
  
  try {
    logger.debug('[MapCache] Fetching all map metadata from database...');
    
    // Single query with JOINs - much more efficient than multiple queries or correlated subqueries
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT 
        m.mapname, 
        m.tier, 
        m.mapper, 
        m.mappersteam,
        COALESCE(pt_cnt.completions, 0) as completions,
        COALESCE(b_cnt.bonus_count, 0) as bonuses,
        COALESCE(s_cnt.stage_count, 0) as stages,
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
        SELECT mapname, COUNT(*) as stage_count 
        FROM ck_zones 
        WHERE zonetype = 3 
        GROUP BY mapname
      ) s_cnt ON m.mapname = s_cnt.mapname
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
    `);
    
    const metadataMap = new Map<string, MapMetadata>();
    
    for (const row of rows) {
      metadataMap.set(row.mapname, {
        mapname: row.mapname,
        tier: row.tier,
        mapper: row.mapper,
        mappersteam: row.mappersteam,
        bonuses: row.bonuses || 0,
        stages: row.stages || 0,
        completions: row.completions || 0,
        wr_time: row.wr_time,
        wr_holder: row.wr_holder,
        wr_holder_steamid: row.wr_holder_steamid,
      });
    }
    
    const duration = Date.now() - startTime;
    logger.debug(`[MapCache] Fetched ${metadataMap.size} maps in ${duration}ms`);
    
    return metadataMap;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logger.error(`[MapCache] Failed to fetch map metadata after ${duration}ms`);
    logger.error(`[MapCache] Error: ${error.message || 'Unknown error'}`);
    throw error;
  }
}

/**
 * Initialize the map cache - called automatically on first access
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
  logger.info('[MapCache] Initializing map metadata cache (1 hour TTL)...');
  
  // Initial fetch - store promise so callers can await it
  cache.initialFetchPromise = fetchAllMapMetadata()
    .then((data) => {
      cache.data = data;
      cache.lastUpdated = Date.now();
      logger.info(`[MapCache] Cache initialized with ${data.size} maps`);
    })
    .catch((err) => {
      logger.error(`[MapCache] Initial fetch failed: ${err.message}`);
    });
}

/**
 * Get all map metadata from cache (with automatic refresh)
 * Returns cached data if valid, otherwise fetches fresh data
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
    cache.initialFetchPromise = null;
  }
  
  // Check if cache is still valid
  const now = Date.now();
  if (now - cache.lastUpdated < MAP_CACHE_TTL && cache.data.size > 0) {
    logger.debug(`[MapCache] Cache hit: ${cache.data.size} maps (age: ${Math.round((now - cache.lastUpdated) / 1000)}s)`);
    return cache.data;
  }
  
  // Cache expired or empty - fetch fresh data
  logger.debug('[MapCache] Cache expired, fetching fresh data...');
  const freshData = await fetchAllMapMetadata();
  cache.data = freshData;
  cache.lastUpdated = now;
  
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
 */
export async function refreshMapCache(): Promise<void> {
  const cache = getGlobalMapCache();
  logger.info('[MapCache] Force refreshing cache...');
  
  const freshData = await fetchAllMapMetadata();
  cache.data = freshData;
  cache.lastUpdated = Date.now();
  
  logger.info(`[MapCache] Cache refreshed with ${freshData.size} maps`);
}