import 'server-only';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
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

/**
 * Fetch all bonus groups, stages, and player count from database in parallel
 */
export async function fetchRegistryData(): Promise<{ bonuses: BonusGroup[]; stages: StageGroup[]; playerCount: number }> {
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
    
    const bonuses: BonusGroup[] = (bonusResult[0]).map((row) => ({
      mapname: row.mapname,
      zonegroup: row.zonegroup,
      wr_time: row.wr_time || null,
    }));
    
    const stages: StageGroup[] = (stageResult[0]).map((row) => ({
      map: row.map,
      stage: row.stage,
      count: row.count,
    }));
    
    const playerCount = (countResult[0])[0].total;
    
    const duration = Date.now() - startTime;
    logger.debug(`[RegistryCache] Fetched ${bonuses.length} bonus groups, ${stages.length} stages, and ${playerCount} players in ${duration}ms`);
    
    return { bonuses, stages, playerCount };
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    const err = error as { message?: string };
    logger.error(`[RegistryCache] Failed to fetch registry data after ${duration}ms`);
    logger.error(`[RegistryCache] Error: ${err.message || 'Unknown error'}`);
    throw error;
  }
}

/**
 * Get all bonus groups from database
 */
export async function getAllBonusGroups(): Promise<BonusGroup[]> {
  const { bonuses } = await fetchRegistryData();
  return bonuses;
}

/**
 * Get all stages from database
 */
export async function getAllStages(): Promise<StageGroup[]> {
  const { stages } = await fetchRegistryData();
  return stages;
}

/**
 * Get total player count from database
 */
export async function getPlayerCount(): Promise<number> {
  const { playerCount } = await fetchRegistryData();
  return playerCount;
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
 */
export async function getBonusGroupsByMap(mapname: string): Promise<number[]> {
  const allBonuses = await getAllBonusGroups();
  return allBonuses
    .filter((b) => b.mapname === mapname)
    .map((b) => b.zonegroup)
    .sort((a, b) => a - b);
}

/**
 * Get stage numbers for a specific map (returns array of stage numbers)
 */
export async function getStagesByMap(mapname: string): Promise<number[]> {
  const allStages = await getAllStages();
  return allStages
    .filter((s) => s.map === mapname)
    .map((s) => s.stage)
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
): Promise<Array<{ mapname: string; tier: number; wr_time: number | null }>> {
  // Import here to avoid circular dependency
  const { fetchAllMapMetadata } = await import('./map-cache');
  
  const allMetadata = await fetchAllMapMetadata();
  const incompleteMaps: Array<{ mapname: string; tier: number; wr_time: number | null }> = [];
  
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
