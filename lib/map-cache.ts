import 'server-only';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import logger from '@/lib/logger';
import { withTimeout } from '@/lib/timeout';
import { getErrorMessage } from './errors';

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

/**
 * Whether a map is staged rather than linear.
 *
 * `stages` comes from `COUNT(*) + 1` over the stage zones, so a linear map is 0
 * and a staged map is at least 2 — never 1. Call sites used to test `> 0` and
 * `> 1` interchangeably, which agreed only by that accident; route every check
 * through here so one query change can't split the filter from the badge.
 */
export function isStagedMap(metadata: Pick<MapMetadata, 'stages'>): boolean {
  return metadata.stages > 1;
}

// Configuration constants
const QUERY_TIMEOUT_MS = 30000; // 30 seconds - prevents indefinite query hanging

/**
 * Fetch all map metadata from database in a single optimized query
 * Uses JOINs instead of correlated subqueries for better performance
 * Includes timeout protection to prevent indefinite query hanging
 */
export async function fetchAllMapMetadata(): Promise<Map<string, MapMetadata>> {
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
        -- MIN() + self-join, NOT a ROW_NUMBER() window: the MIN is answered by a
        -- loose index scan of ~862 index entries, while partitioning over
        -- ck_playertimes forces a full sort of 1.6M rows (100ms vs >300s).
        LEFT JOIN (
          SELECT mapname, MIN(runtimepro) as min_runtime
          FROM ck_playertimes
          GROUP BY mapname
        ) wr ON m.mapname = wr.mapname
        LEFT JOIN ck_playertimes wr_holder
          ON wr.mapname = wr_holder.mapname
          AND wr.min_runtime = wr_holder.runtimepro
        WHERE pt_cnt.completions > 0
        -- The join emits one row per tied holder (11 maps today), so the sort
        -- keys fix which one the loop below keeps. Cheap: it orders the ~1038
        -- joined rows, not the base table.
        ORDER BY m.mapname ASC, wr_holder.date ASC, wr_holder.steamid ASC
      `),
      QUERY_TIMEOUT_MS,
      'Query timeout exceeded'
    );
    
    const metadataMap = new Map<string, MapMetadata>();
    
    for (const row of rows) {
      // First row per map wins. Combined with the ORDER BY above that means the
      // earliest run, then the lowest steamid, so a tied WR resolves to a stable
      // holder instead of whichever row MySQL happened to return last.
      if (metadataMap.has(row.mapname)) continue;

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
    
    return metadataMap;
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    
    // Handle timeout specifically
    if (getErrorMessage(error) === 'Query timeout exceeded') {
      logger.error(`[MapCache] Query timeout after ${duration}ms`);
      throw new Error(`Map metadata query exceeded ${QUERY_TIMEOUT_MS / 1000} second timeout`, { cause: error });
    }
    
    logger.error(`[MapCache] Failed to fetch map metadata after ${duration}ms`);
    logger.error(`[MapCache] Error: ${getErrorMessage(error)}`);
    throw error;
  }
}

/**
 * Get totals for progress bars (maps, bonuses, stages)
 */
export async function getTotals(): Promise<{
  totalMaps: number;
  totalBonuses: number;
  totalStages: number;
}> {
  const allMetadata = await fetchAllMapMetadata();
  
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
