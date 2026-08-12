import 'server-only';
import { mapCachedFetch } from './map-cached-fetch';
import pool from './db';
import analyticsPool, { isAnalyticsAvailable } from './db-analytics';
import type { RowDataPacket } from 'mysql2';
import { getMapMetadataFromCache } from './valkey-map-cache';
import { isStagedMap } from './map-cache';
import { validateMapName } from './validators';
import { MAP_STATS_SUFFIXES, wrCheckpointSuffix } from './cache-keys';

const STATS_CACHE_TTL = 43200; // 12 hours

// Every fetcher here aggregates over ck_playertimes/ck_checkpoints/ck_bonus, so all
// of them pass `expensive: true`; otherwise the precache floods the 20-connection
// pool with concurrent aggregates while page renders wait.

interface CompletionsOverTimeData extends RowDataPacket {
  date: string;
  count: number;
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

interface CheckpointStatsResult {
  checkpointAvgTimes: Array<{ checkpoint: number; avgTime: number; sampleSize: number }>;
}

/**
 * Process checkpoint rows into average times statistics
 */
function processCheckpointData(
  checkpointRows: RowDataPacket[],
  maxCheckpoint: number
): CheckpointStatsResult {
  const checkpointStats = new Map<number, { reached: number; totalTime: number; sampleSize: number }>();

  for (const row of checkpointRows) {
    for (let i = 1; i <= maxCheckpoint; i++) {
      const colName = `cp${i}` as keyof typeof row;
      const cpTime = row[colName];

      if (cpTime !== null && cpTime !== undefined) {
        if (!checkpointStats.has(i)) {
          checkpointStats.set(i, { reached: 0, totalTime: 0, sampleSize: 0 });
        }
        const stats = checkpointStats.get(i);
        if (stats) {
          stats.reached += 1;
          stats.totalTime += cpTime as number;
          stats.sampleSize += 1;
        }
      }
    }
  }

  const checkpointAvgTimes = Array.from(checkpointStats.keys())
    .sort((a, b) => a - b)
    .flatMap(cpNum => {
      const stats = checkpointStats.get(cpNum);
      if (!stats) return [];
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
 * Get WR checkpoint times from cache
 */
export async function getWRCheckpointTimesFromCache(
  mapname: string,
  maxCheckpoint: number
): Promise<Array<{ checkpoint: number; time: number }> | undefined> {
  if (maxCheckpoint === 0) {
    return undefined;
  }

  return mapCachedFetch<Array<{ checkpoint: number; time: number }> | undefined>({
    mapname,
    keySuffix: wrCheckpointSuffix(maxCheckpoint),
    ttl: STATS_CACHE_TTL,
    empty: undefined,
    errorLabel: 'WR checkpoint times',
    expensive: true,
    errorLevel: 'warn',
    fetch: async (validMapname) => {
      const mapMetadata = await getMapMetadataFromCache(validMapname);
      const wrSteamid = mapMetadata?.wr_holder_steamid || null;

      if (!wrSteamid) {
        return undefined;
      }

      const MAX_CHECKPOINTS = 75;
      if (maxCheckpoint > MAX_CHECKPOINTS || maxCheckpoint < 0) {
        throw new Error('Invalid checkpoint count');
      }

      const validColumns = new Set<string>();
      for (let i = 1; i <= MAX_CHECKPOINTS; i++) {
        validColumns.add(`cp${i}`);
      }

      const checkpointColumns: string[] = [];
      for (let i = 1; i <= maxCheckpoint; i++) {
        const colName = `cp${i}`;
        if (!validColumns.has(colName)) {
          throw new Error(`Invalid checkpoint column: ${colName}`);
        }
        checkpointColumns.push(colName);
      }

      const [wrCheckpointRows] = await pool.query<RowDataPacket[]>(`
        SELECT ${checkpointColumns.join(', ')}
        FROM ck_checkpoints
        WHERE mapname = ? AND steamid = ?
      `, [validMapname, wrSteamid]);

      if (wrCheckpointRows.length === 0) {
        return undefined;
      }

      const row = wrCheckpointRows[0];
      const checkpointData: Array<{ checkpoint: number; time: number }> = [];

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
    },
  });
}

/**
 * Get checkpoint stats from cache
 */
export async function getCheckpointStatsFromCache(mapname: string): Promise<CheckpointStatsResult> {
  return mapCachedFetch<CheckpointStatsResult>({
    mapname,
    keySuffix: MAP_STATS_SUFFIXES.checkpoints,
    ttl: STATS_CACHE_TTL,
    empty: { checkpointAvgTimes: [] },
    errorLabel: 'checkpoint stats',
    expensive: true,
    errorLevel: 'warn',
    fetch: async (validMapname) => {
      const mapMetadata = await getMapMetadataFromCache(validMapname);
      const checkpoints = mapMetadata?.checkpoints || 0;
      const stages = mapMetadata?.stages || 0;
      const maxCheckpoint = checkpoints > 0 ? checkpoints : stages;

      if (maxCheckpoint === 0) {
        return { checkpointAvgTimes: [] };
      }

      const MAX_CHECKPOINTS = 75;
      if (maxCheckpoint > MAX_CHECKPOINTS || maxCheckpoint < 0) {
        throw new Error('Invalid checkpoint count');
      }

      const validColumns = new Set<string>();
      for (let i = 1; i <= MAX_CHECKPOINTS; i++) {
        validColumns.add(`cp${i}`);
      }

      const checkpointColumns: string[] = [];
      for (let i = 1; i <= maxCheckpoint; i++) {
        const colName = `cp${i}`;
        if (!validColumns.has(colName)) {
          throw new Error(`Invalid checkpoint column: ${colName}`);
        }
        checkpointColumns.push(colName);
      }

      const [checkpointRows] = await pool.query<RowDataPacket[]>(`
        SELECT ${checkpointColumns.join(', ')}
        FROM ck_checkpoints
        WHERE mapname = ?
      `, [validMapname]);

      return processCheckpointData(checkpointRows, maxCheckpoint);
    },
  });
}

/**
 * Get bonus completions over time from cache
 */
export async function getBonusCompletionsOverTimeFromCache(
  mapname: string
): Promise<Record<number, Array<{ date: string; count: number }>>> {
  return mapCachedFetch<Record<number, Array<{ date: string; count: number }>>>({
    mapname,
    keySuffix: MAP_STATS_SUFFIXES.bonusTime,
    ttl: STATS_CACHE_TTL,
    empty: {},
    errorLabel: 'bonus completions over time',
    expensive: true,
    errorLevel: 'warn',
    fetch: async (validMapname) => {
      const [bonusRows] = await pool.query<BonusTimeSeriesData[]>(`
        SELECT
          DATE_FORMAT(date, '%Y-%m-01') as date,
          zonegroup as bonus,
          COUNT(*) as count
        FROM ck_bonus
        WHERE mapname = ?
        GROUP BY DATE_FORMAT(date, '%Y-%m'), zonegroup
        ORDER BY date ASC, zonegroup ASC
      `, [validMapname]);

      const bonusData: Record<number, Array<{ date: string; count: number }>> = {};

      for (const row of bonusRows) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
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
  });
}

/**
 * Get completions over time from cache
 */
export async function getCompletionsOverTimeFromCache(mapname: string): Promise<Array<{ date: string; count: number }>> {
  return mapCachedFetch<Array<{ date: string; count: number }>>({
    mapname,
    keySuffix: MAP_STATS_SUFFIXES.completions,
    ttl: STATS_CACHE_TTL,
    empty: [],
    errorLabel: 'completions over time',
    expensive: true,
    errorLevel: 'warn',
    fetch: async (validMapname) => {
      const [completionsRows] = await pool.query<CompletionsOverTimeData[]>(`
        SELECT
          DATE_FORMAT(date, '%Y-%m-01') as date,
          COUNT(*) as count
        FROM ck_playertimes
        WHERE mapname = ?
        GROUP BY DATE_FORMAT(date, '%Y-%m')
        ORDER BY date ASC
      `, [validMapname]);

      return completionsRows.map(row => ({
        date: row.date,
        count: row.count,
      }));
    },
  });
}

/**
 * Get time on map data from cache.
 *
 * Backed by the optional analytics DB, so it short-circuits when that database
 * is absent or unhealthy: without the guard every map render and every precache
 * pass attempted a doomed connection and logged a warning. The empty result is
 * deliberately returned *outside* the cache, so it isn't pinned for the TTL and
 * the chart repopulates as soon as the health probe recovers.
 */
export async function getTimeOnMapDataFromCache(mapname: string): Promise<Array<{ date: string; totalDuration: number }>> {
  if (!isAnalyticsAvailable()) {
    return [];
  }

  return mapCachedFetch<Array<{ date: string; totalDuration: number }>>({
    mapname,
    keySuffix: MAP_STATS_SUFFIXES.timeOnMap,
    ttl: STATS_CACHE_TTL,
    empty: [],
    errorLabel: 'time on map data',
    expensive: true,
    errorLevel: 'warn',
    fetch: async (validMapname) => {
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

      let cumulativeTotalHours = 0;
      return timeOnMapRows.map(row => {
        const hours = (row.total_duration || 0) / 3600;
        cumulativeTotalHours += hours;
        return {
          date: row.date,
          totalDuration: cumulativeTotalHours,
        };
      });
    },
  });
}

/**
 * Get finish time data from cache
 */
export async function getFinishTimeDataFromCache(mapname: string): Promise<{ avgTime: number | null; wrTime: number | null }> {
  return mapCachedFetch<{ avgTime: number | null; wrTime: number | null }>({
    mapname,
    keySuffix: MAP_STATS_SUFFIXES.finishTime,
    ttl: STATS_CACHE_TTL,
    empty: { avgTime: null, wrTime: null },
    errorLabel: 'finish time data',
    expensive: true,
    errorLevel: 'warn',
    fetch: async (validMapname) => {
      const [finishRows] = await pool.query<RowDataPacket[]>(`
        SELECT
          AVG(runtimepro) as avgTime,
          MIN(runtimepro) as wrTime
        FROM ck_playertimes
        WHERE mapname = ?
      `, [validMapname]);

      const avgTime = finishRows[0]?.avgTime || null;
      const wrTime = finishRows[0]?.wrTime || null;

      return {
        avgTime: avgTime ? Number(avgTime) : null,
        wrTime: wrTime ? Number(wrTime) : null,
      };
    },
  });
}

/**
 * Get percentile completion times from cache
 * Uses MariaDB-compatible queries with LIMIT/OFFSET
 */
export async function getPercentileTimesFromCache(
  mapname: string
): Promise<{
  wrTime: number | null;
  p1Time: number | null;
  p10Time: number | null;
  medianTime: number | null;
  avgTime: number | null;
} | null> {
  return mapCachedFetch<{
    wrTime: number | null;
    p1Time: number | null;
    p10Time: number | null;
    medianTime: number | null;
    avgTime: number | null;
  } | null>({
    mapname,
    keySuffix: MAP_STATS_SUFFIXES.percentiles,
    ttl: STATS_CACHE_TTL,
    empty: null,
    errorLabel: 'percentile times',
    expensive: true,
    errorLevel: 'warn',
    fetch: async (validMapname) => {
      // First, get count, min (WR), and avg in a single query
      const [summaryRows] = await pool.query<RowDataPacket[]>(`
        SELECT
          MIN(runtimepro) as wrTime,
          AVG(runtimepro) as avgTime,
          COUNT(*) as totalCount
        FROM ck_playertimes
        WHERE mapname = ?
      `, [validMapname]);

      const summary = summaryRows[0];
      const totalCount = summary.totalCount || 0;

      if (totalCount === 0) {
        return { wrTime: null, p1Time: null, p10Time: null, medianTime: null, avgTime: null };
      }

      // Calculate offsets for percentiles (0-indexed)
      const p1Offset = Math.max(0, Math.floor(totalCount * 0.01));
      const p10Offset = Math.max(0, Math.floor(totalCount * 0.10));
      const medianOffset = Math.max(0, Math.floor(totalCount * 0.50));

      // Get each percentile value using LIMIT 1 OFFSET
      const [p1Rows] = await pool.query<RowDataPacket[]>(`
        SELECT runtimepro FROM ck_playertimes
        WHERE mapname = ?
        ORDER BY runtimepro ASC
        LIMIT 1 OFFSET ?
      `, [validMapname, p1Offset]);

      const [p10Rows] = await pool.query<RowDataPacket[]>(`
        SELECT runtimepro FROM ck_playertimes
        WHERE mapname = ?
        ORDER BY runtimepro ASC
        LIMIT 1 OFFSET ?
      `, [validMapname, p10Offset]);

      const [medianRows] = await pool.query<RowDataPacket[]>(`
        SELECT runtimepro FROM ck_playertimes
        WHERE mapname = ?
        ORDER BY runtimepro ASC
        LIMIT 1 OFFSET ?
      `, [validMapname, medianOffset]);

      return {
        wrTime: summary.wrTime ? Number(summary.wrTime) : null,
        p1Time: p1Rows[0].runtimepro ? Number(p1Rows[0].runtimepro) : null,
        p10Time: p10Rows[0].runtimepro ? Number(p10Rows[0].runtimepro) : null,
        medianTime: medianRows[0].runtimepro ? Number(medianRows[0].runtimepro) : null,
        avgTime: summary.avgTime ? Number(summary.avgTime) : null,
      };
    },
  });
}

/**
 * Aggregated chart data for a map's stats grid.
 *
 * Composed by the map page (server-rendered → passed as props to MapChartGrid)
 * from the underlying cached sub-fetches.
 */
export interface MapChartData {
  completionsOverTime: Array<{ date: string; count: number }>;
  timeOnMapData: Array<{ date: string; totalDuration: number }>;
  checkpointAvgTimes: Array<{ checkpoint: number; avgTime: number; sampleSize: number }>;
  wrCheckpointTimes?: Array<{ checkpoint: number; time: number }>;
  finishTime?: { avgTime: number | null; wrTime: number | null };
  bonusCompletionsOverTime: Record<number, Array<{ date: string; count: number }>>;
  isStageMap: boolean;
  percentileTimes: {
    wrTime: number | null;
    p1Time: number | null;
    p10Time: number | null;
    medianTime: number | null;
    avgTime: number | null;
  } | null;
}

/**
 * Compose the full chart-data payload for a map from its cached sub-fetches.
 * Returns empty series (but the correct `isStageMap`) for maps with no completions.
 */
export async function getMapChartDataFromCache(mapname: string): Promise<MapChartData> {
  const validMapname = validateMapName(mapname);
  if (!validMapname) {
    return {
      completionsOverTime: [],
      timeOnMapData: [],
      checkpointAvgTimes: [],
      bonusCompletionsOverTime: {},
      isStageMap: false,
      percentileTimes: null,
    };
  }

  // Map metadata (cached, 1h TTL) — includes completions count, checkpoints, stages.
  const mapMetadata = await getMapMetadataFromCache(validMapname);
  const totalCompletions = mapMetadata?.completions || 0;
  const checkpoints = mapMetadata?.checkpoints || 0;
  const stages = mapMetadata?.stages || 0;
  // For staged maps, stages double as checkpoints (stored in ck_checkpoints).
  const maxCheckpoint = checkpoints > 0 ? checkpoints : stages;
  const isStageMap = isStagedMap({ stages });

  if (totalCompletions === 0) {
    return {
      completionsOverTime: [],
      timeOnMapData: [],
      checkpointAvgTimes: [],
      bonusCompletionsOverTime: {},
      isStageMap,
      percentileTimes: null,
    };
  }

  const [
    completionsOverTime,
    timeOnMapData,
    { checkpointAvgTimes },
    wrCheckpointTimes,
    finishTime,
    bonusCompletionsOverTime,
    percentileTimes,
  ] = await Promise.all([
    getCompletionsOverTimeFromCache(validMapname),
    getTimeOnMapDataFromCache(validMapname),
    getCheckpointStatsFromCache(validMapname),
    getWRCheckpointTimesFromCache(validMapname, maxCheckpoint),
    getFinishTimeDataFromCache(validMapname),
    getBonusCompletionsOverTimeFromCache(validMapname),
    getPercentileTimesFromCache(validMapname),
  ]);

  return {
    completionsOverTime,
    timeOnMapData,
    checkpointAvgTimes,
    wrCheckpointTimes,
    finishTime,
    bonusCompletionsOverTime,
    isStageMap,
    percentileTimes,
  };
}
