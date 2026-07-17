import 'server-only';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import logger from '@/lib/logger';
import { getErrorMessage } from './errors';

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
      // Only ranked players (points > 0) — this count drives the players-list
      // pagination total, which excludes 0-point players.
      pool.query<RowDataPacket[]>(`
        SELECT COUNT(*) as total FROM ck_playerrank WHERE points > 0
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
    logger.error(`[RegistryCache] Failed to fetch registry data after ${duration}ms`);
    logger.error(`[RegistryCache] Error: ${getErrorMessage(error)}`);
    throw error;
  }
}
