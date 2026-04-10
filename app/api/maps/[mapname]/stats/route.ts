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

interface BonusTimeSeriesData extends RowDataPacket {
  date: string;
  bonus: number;
  count: number;
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
  finishTime?: {
    avgTime: number; // Average map completion time
    wrTime: number | null; // WR holder's total time
  };
  bonusCompletionRates: Array<{ bonus: number; completionRate: number; completions: number }>;
  bonusCompletionsOverTime: { [bonus: number]: Array<{ date: string; count: number }> };
  isStageMap: boolean; // true if map has stages (zonetype 3), false for linear maps (zonetype 4)
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
 * Cached function to fetch WR holder's checkpoint times for a map
 * For staged maps, this fetches stage completion times from ck_checkpoints table
 */
const getWRCheckpointTimes = unstable_cache(
  async (mapname: string, maxCheckpoint: number) => {
    if (maxCheckpoint === 0) {
      return undefined;
    }

    try {
      // Get WR holder's steamid from cached map metadata
      const mapMetadata = await getMapMetadata(mapname);
      const wrSteamid = mapMetadata?.wr_holder_steamid || null;
      
      if (!wrSteamid) {
        return undefined;
      }
      
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
      logger.warn(`[getWRCheckpointTimes] Failed to fetch WR checkpoint times for ${mapname}: ${error.message}`);
      return undefined;
    }
  },
  ['wr-checkpoint-times'],
  { revalidate: 3600 } // 1 hour cache
);

/**
 * Cached function to fetch bonus completion rates for a map
 */
const getBonusCompletionRates = unstable_cache(
  async (mapname: string, totalCompletions: number) => {
    const [bonusRows] = await pool.query<BonusData[]>(`
      SELECT
        zonegroup as bonus,
        COUNT(*) as completions,
        ? as total
      FROM ck_bonus
      WHERE mapname = ?
      GROUP BY zonegroup
      ORDER BY zonegroup ASC
    `, [totalCompletions, mapname]);

    return bonusRows.map(row => ({
      bonus: row.bonus,
      completionRate: row.completions / row.total,
      completions: row.completions,
    }));
  },
  ['bonus-completion-rates'],
  { revalidate: 3600 } // 1 hour cache
);

/**
 * Cached function to fetch checkpoint statistics for a map
 * For linear maps: uses mapMetadata.checkpoints (zonetype=4)
 * For staged maps: uses mapMetadata.stages (zonetype=3) since stages are stored in ck_checkpoints table
 */
const getCheckpointStats = unstable_cache(
  async (mapname: string) => {
    // Get checkpoint count from cached map metadata
    const mapMetadata = await getMapMetadata(mapname);
    const checkpoints = mapMetadata?.checkpoints || 0;
    const stages = mapMetadata?.stages || 0;

    // For staged maps, use stage count as the max checkpoint column to fetch
    // Staged maps store stage times in ck_checkpoints table (cp1, cp2, etc.)
    const maxCheckpoint = checkpoints > 0 ? checkpoints : stages;

    if (maxCheckpoint === 0) {
      return { checkpointAvgTimes: [], wrCheckpointTimes: [] };
    }

    // Build dynamic column list based on max checkpoint count
    const checkpointColumns = Array.from({ length: maxCheckpoint }, (_, i) => `cp${i + 1}`);

    // Fetch only existing checkpoint columns
    const [checkpointRows] = await pool.query<RowDataPacket[]>(`
      SELECT ${checkpointColumns.join(', ')}
      FROM ck_checkpoints
      WHERE mapname = ?
    `, [mapname]);

    return processCheckpointData(checkpointRows, maxCheckpoint);
  },
  ['checkpoint-stats'],
  { revalidate: 3600 } // 1 hour cache
);

/**
 * Cached function to fetch bonus completions over time for a map
 * Groups bonus completions by month and zonegroup
 */
const getBonusCompletionsOverTime = unstable_cache(
  async (mapname: string) => {
    const [bonusRows] = await pool.query<BonusTimeSeriesData[]>(`
      SELECT
        DATE_FORMAT(date, '%Y-%m-01') as date,
        zonegroup as bonus,
        COUNT(*) as count
      FROM ck_bonus
      WHERE mapname = ?
      GROUP BY DATE_FORMAT(date, '%Y-%m'), zonegroup
      ORDER BY date ASC, zonegroup ASC
    `, [mapname]);

    // Group by bonus number
    const bonusData: { [bonus: number]: Array<{ date: string; count: number }> } = {};
    
    for (const row of bonusRows) {
      if (!bonusData[row.bonus]) {
        bonusData[row.bonus] = [];
      }
      bonusData[row.bonus].push({
        date: row.date,
        count: row.count,
      });
    }

    return bonusData;
  },
  ['bonus-completions-over-time'],
  { revalidate: 3600 } // 1 hour cache
);

/**
 * Cached function to fetch completions over time for a map
 * Groups completions by month from ck_playertimes table
 */
const getCompletionsOverTime = unstable_cache(
  async (mapname: string) => {
    const [completionsRows] = await pool.query<CompletionsOverTimeData[]>(`
      SELECT
        DATE_FORMAT(date, '%Y-%m-01') as date,
        COUNT(*) as count
      FROM ck_playertimes
      WHERE mapname = ?
      GROUP BY DATE_FORMAT(date, '%Y-%m')
      ORDER BY date ASC
    `, [mapname]);

    return completionsRows.map(row => ({
      date: row.date,
      count: row.count,
    }));
  },
  ['completions-over-time'],
  { revalidate: 3600 } // 1 hour cache
);

/**
 * Cached function to fetch time on map data for a map
 * Groups cumulative playtime by month from player_analytics table
 */
const getTimeOnMapData = unstable_cache(
  async (mapname: string) => {
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
      `, [mapname]);

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
      logger.warn(`[getTimeOnMapData] Failed to fetch time on map data for ${mapname}: ${error.message}`);
    }
    
    return timeOnMapData;
  },
  ['time-on-map-data'],
  { revalidate: 3600 } // 1 hour cache
);

/**
 * Cached function to fetch finish time statistics for a map
 * Calculates average completion time and WR holder's total time from ck_playertimes
 */
const getFinishTimeData = unstable_cache(
  async (mapname: string) => {
    try {
      // Get average completion time and WR time
      const [finishRows] = await pool.query<RowDataPacket[]>(`
        SELECT
          AVG(runtimepro) as avgTime,
          MIN(runtimepro) as wrTime
        FROM ck_playertimes
        WHERE mapname = ?
      `, [mapname]);

      const avgTime = finishRows[0]?.avgTime || null;
      const wrTime = finishRows[0]?.wrTime || null;

      return {
        avgTime: avgTime ? Number(avgTime) : null,
        wrTime: wrTime ? Number(wrTime) : null,
      };
    } catch (error: any) {
      logger.warn(`[getFinishTimeData] Failed to fetch finish time data for ${mapname}: ${error.message}`);
      return { avgTime: null, wrTime: null };
    }
  },
  ['finish-time-data'],
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
    // Get map metadata (already cached with 1 hour TTL in lib/map-cache.ts)
    // This includes completions count and wr_holder_steamid
    const mapMetadata = await getMapMetadata(validMapname);
    const totalCompletions = mapMetadata?.completions || 0;
    const checkpoints = mapMetadata?.checkpoints || 0;
    const stages = mapMetadata?.stages || 0;
    // For staged maps, use stage count as maxCheckpoint since stages are stored in ck_checkpoints table
    const maxCheckpoint = checkpoints > 0 ? checkpoints : stages;
    const isStageMap = stages > 0;

    if (totalCompletions === 0) {
      // No data available for this map
      return NextResponse.json({
        completionsOverTime: [],
        timeOnMapData: [],
        checkpointAvgTimes: [],
        bonusCompletionRates: [],
        bonusCompletionsOverTime: {},
        isStageMap,
      } as StatsResponse);
    }

    // Query 1: Completions Over Time (cached)
    const completionsOverTime = await getCompletionsOverTime(validMapname);

    // Query 2: Time on Map Data (cached)
    const timeOnMapData = await getTimeOnMapData(validMapname);

    // Query 3: Checkpoint Data (Average Times) - use cached checkpoint count
    const { checkpointAvgTimes } = await getCheckpointStats(validMapname);

    // Query 4: WR Checkpoint Times (cached)
    const wrCheckpointTimes = await getWRCheckpointTimes(validMapname, maxCheckpoint);

    // Query 5: Finish Time Data (cached)
    const finishTimeData = await getFinishTimeData(validMapname);

    // Query 6: Bonus Completion Rates (cached)
    const bonusCompletionRates = await getBonusCompletionRates(validMapname, totalCompletions);

    // Query 7: Bonus Completions Over Time (cached)
    const bonusCompletionsOverTime = await getBonusCompletionsOverTime(validMapname);

    logger.debug(`[API Stats] Fetched stats for ${validMapname}: ${completionsOverTime.length} time points, ${checkpointAvgTimes.length} checkpoints, ${bonusCompletionRates.length} bonuses, ${Object.keys(bonusCompletionsOverTime).length} bonus time series, ${wrCheckpointTimes ? wrCheckpointTimes.length : 0} WR checkpoint times, finishTime: ${finishTimeData.avgTime ? finishTimeData.avgTime.toFixed(1) : 'null'}s avg, ${finishTimeData.wrTime ? finishTimeData.wrTime.toFixed(1) : 'null'}s WR`);

    return NextResponse.json({
      completionsOverTime,
      timeOnMapData,
      checkpointAvgTimes,
      wrCheckpointTimes,
      finishTime: finishTimeData,
      bonusCompletionRates,
      bonusCompletionsOverTime,
      isStageMap,
    } as StatsResponse);
  } catch (error: any) {
    logger.error(`[API Stats] Failed to fetch stats for ${validMapname}: ${error.message}`);
    return NextResponse.json(
      { error: 'Failed to fetch map statistics' },
      { status: 500 }
    );
  }
}
