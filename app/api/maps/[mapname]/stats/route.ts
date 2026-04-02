import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import analyticsPool from '@/lib/db-analytics';
import { RowDataPacket } from 'mysql2';
import { sanitizeMapName } from '@/lib/sanitize';
import logger from '@/lib/logger';
import { getMapMetadata } from '@/lib/map-cache';
import { unstable_cache } from 'next/cache';

const DEFAULT_DAYS = 365 * 9; // ~9 years to cover data since 2017

interface CompletionsOverTimeData extends RowDataPacket {
  date: string;
  count: number;
}

interface BonusData extends RowDataPacket {
  bonus: number;
  completions: number;
  total: number;
}

interface TimeOnMapData extends RowDataPacket {
  date: string;
  total_duration: number;
}

interface StatsResponse {
  completionsOverTime: Array<{ date: string; count: number }>;
  timeOnMapData: Array<{ date: string; totalDuration: number }>;
  checkpointAvgTimes: Array<{ checkpoint: number; avgTime: number; sampleSize: number }>;
  wrCheckpointTimes?: Array<{ checkpoint: number; time: number }>;
  bonusCompletionRates: Array<{ bonus: number; completionRate: number; completions: number }>;
}

/**
 * Process checkpoint rows into average times statistics
 */
function processCheckpointData(
  checkpointRows: RowDataPacket[],
  maxCheckpoint: number
): { checkpointAvgTimes: StatsResponse['checkpointAvgTimes'] } {
  const checkpointStats = new Map<number, { reached: number; totalTime: number; sampleSize: number }>();

  for (const row of checkpointRows) {
    for (let i = 1; i <= maxCheckpoint; i++) {
      const colName = `cp${i}` as keyof typeof row;
      const cpTime = row[colName];

      if (cpTime !== null && cpTime !== undefined) {
        if (!checkpointStats.has(i)) {
          checkpointStats.set(i, { reached: 0, totalTime: 0, sampleSize: 0 });
        }
        const stats = checkpointStats.get(i)!;
        stats.reached += 1;
        stats.totalTime += cpTime as number;
        stats.sampleSize += 1;
      }
    }
  }

  // Convert to arrays for average times
  const checkpointAvgTimes = Array.from(checkpointStats.keys())
    .sort((a, b) => a - b)
    .map(cpNum => {
      const stats = checkpointStats.get(cpNum)!;
      return {
        checkpoint: cpNum,
        avgTime: stats.totalTime / stats.sampleSize,
        sampleSize: stats.sampleSize,
      };
    })
    .filter(cp => cp.avgTime > 0 && cp.sampleSize > 0);

  return { checkpointAvgTimes };
}

/**
 * Fetch WR holder's checkpoint times for a map
 */
async function getWRCheckpointTimes(mapname: string, maxCheckpoint: number): Promise<Array<{ checkpoint: number; time: number }> | undefined> {
  if (maxCheckpoint === 0) {
    return undefined;
  }

  try {
    // Get the WR holder's steamid
    const [wrHolderRows] = await pool.query<RowDataPacket[]>(`
      SELECT steamid
      FROM ck_playertimes
      WHERE mapname = ?
      ORDER BY runtimepro ASC
      LIMIT 1
    `, [mapname]);
    
    if (wrHolderRows.length === 0) {
      return undefined;
    }
    
    const wrSteamid = wrHolderRows[0].steamid;
    
    // Build dynamic column list based on max checkpoint
    const checkpointColumns = Array.from({ length: maxCheckpoint }, (_, i) => `cp${i + 1}`);
    
    // Get WR holder's checkpoint times - fetch only existing cp columns
    const [wrCheckpointRows] = await pool.query<RowDataPacket[]>(`
      SELECT ${checkpointColumns.join(', ')}
      FROM ck_checkpoints
      WHERE mapname = ? AND steamid = ?
    `, [mapname, wrSteamid]);
    
    if (wrCheckpointRows.length === 0) {
      return undefined;
    }
    
    const row = wrCheckpointRows[0];
    const checkpointData: Array<{ checkpoint: number; time: number }> = [];
    
    // Extract non-null checkpoint times
    for (let i = 1; i <= maxCheckpoint; i++) {
      const colName = `cp${i}` as keyof typeof row;
      if (row[colName] !== null && row[colName] !== undefined) {
        checkpointData.push({
          checkpoint: i,
          time: row[colName] as number,
        });
      }
    }
    
    return checkpointData;
  } catch (error: any) {
    logger.warn(`[API Stats] Failed to fetch WR checkpoint times for ${mapname}: ${error.message}`);
    return undefined;
  }
}

/**
 * Cached function to fetch checkpoint statistics for a map
 */
const getCheckpointStats = unstable_cache(
  async (mapname: string) => {
    // Get checkpoint count from cached map metadata
    const mapMetadata = await getMapMetadata(mapname);
    const checkpoints = mapMetadata?.checkpoints || 0;

    if (checkpoints === 0) {
      return { checkpointAvgTimes: [], wrCheckpointTimes: [] };
    }

    // Build dynamic column list based on checkpoint count
    const checkpointColumns = Array.from({ length: checkpoints }, (_, i) => `cp${i + 1}`);

    // Fetch only existing checkpoint columns
    const [checkpointRows] = await pool.query<RowDataPacket[]>(`
      SELECT ${checkpointColumns.join(', ')}
      FROM ck_checkpoints
      WHERE mapname = ?
    `, [mapname]);

    return processCheckpointData(checkpointRows, checkpoints);
  },
  ['checkpoint-stats'],
  { revalidate: 3600 } // 1 hour cache
);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mapname: string }> }
) {
  const { mapname } = await params;
  const decodedMapname = decodeURIComponent(mapname);
  const validMapname = sanitizeMapName(decodedMapname);

  if (!validMapname) {
    return NextResponse.json({ error: 'Invalid map name' }, { status: 400 });
  }

  const searchParams = request.nextUrl.searchParams;
  const days = Math.min(365, Math.max(1, parseInt(searchParams.get('days') || String(DEFAULT_DAYS), 10)));

  try {
    // Get total completions for the map (used as denominator for rates)
    const [totalRows] = await pool.query<RowDataPacket[]>(`
      SELECT COUNT(*) as total FROM ck_playertimes WHERE mapname = ?
    `, [validMapname]);
    const totalCompletions = totalRows[0]?.total || 0;

    if (totalCompletions === 0) {
      // No data available for this map
      return NextResponse.json({
        completionsOverTime: [],
        timeOnMapData: [],
        checkpointAvgTimes: [],
        bonusCompletionRates: [],
      } as StatsResponse);
    }

    // Get map metadata to know how many checkpoints exist
    const mapMetadata = await getMapMetadata(validMapname);
    const maxCheckpoint = mapMetadata?.checkpoints || 0;

    // Query 1: Completions Over Time (grouped by month, all available data)
    const [completionsRows] = await pool.query<CompletionsOverTimeData[]>(`
      SELECT
        DATE_FORMAT(date, '%Y-%m-01') as date,
        COUNT(*) as count
      FROM ck_playertimes
      WHERE mapname = ?
      GROUP BY DATE_FORMAT(date, '%Y-%m')
      ORDER BY date ASC
    `, [validMapname]);

    const completionsOverTime = completionsRows.map(row => ({
      date: row.date,
      count: row.count,
    }));

    // Query 2: Time on Map Data (from player_analytics table) - grouped by month, cumulative in hours
    // Filter to past year for performance optimization
    // Uses connect_date column with composite index (idx_connect_date_map_duration) for fast lookups
    let timeOnMapData: Array<{ date: string; totalDuration: number }> = [];
    
    try {
      const [timeOnMapRows] = await analyticsPool.query<TimeOnMapData[]>(`
        SELECT
          DATE_FORMAT(connect_date, '%Y-%m-01') as date,
          SUM(duration) as total_duration
        FROM player_analytics
        WHERE map = ?
          AND duration IS NOT NULL
        GROUP BY DATE_FORMAT(connect_date, '%Y-%m-01')
        ORDER BY date ASC
      `, [validMapname]);

      // Calculate cumulative total (convert seconds to hours)
      let cumulativeTotalHours = 0;
      timeOnMapData = timeOnMapRows.map(row => {
        const hours = (row.total_duration || 0) / 3600;
        cumulativeTotalHours += hours;
        return {
          date: row.date,
          totalDuration: cumulativeTotalHours,
        };
      });
    } catch (error: any) {
      logger.warn(`[API Stats] Failed to fetch time on map data for ${validMapname}: ${error.message}`);
      // Continue without time on map data - not critical
    }

    // Query 3: Checkpoint Data (Average Times) - use cached checkpoint count
    const { checkpointAvgTimes } = await getCheckpointStats(validMapname);

    // Query 4: WR Checkpoint Times - fetch WR holder's checkpoint times
    const wrCheckpointTimes = await getWRCheckpointTimes(validMapname, maxCheckpoint);

    // Query 5: Bonus Completion Rates
    const [bonusRows] = await pool.query<BonusData[]>(`
      SELECT 
        zonegroup as bonus,
        COUNT(*) as completions,
        ? as total
      FROM ck_bonus
      WHERE mapname = ?
      GROUP BY zonegroup
      ORDER BY zonegroup ASC
    `, [totalCompletions, validMapname]);

    const bonusCompletionRates = bonusRows.map(row => ({
      bonus: row.bonus,
      completionRate: row.completions / row.total,
      completions: row.completions,
    }));

    logger.debug(`[API Stats] Fetched stats for ${validMapname}: ${completionsOverTime.length} time points, ${checkpointAvgTimes.length} checkpoints, ${bonusCompletionRates.length} bonuses, ${wrCheckpointTimes ? wrCheckpointTimes.length : 0} WR checkpoint times`);

    return NextResponse.json({
      completionsOverTime,
      timeOnMapData,
      checkpointAvgTimes,
      wrCheckpointTimes,
      bonusCompletionRates,
    } as StatsResponse);
  } catch (error: any) {
    logger.error(`[API Stats] Failed to fetch stats for ${validMapname}: ${error.message}`);
    return NextResponse.json(
      { error: 'Failed to fetch map statistics' },
      { status: 500 }
    );
  }
}
