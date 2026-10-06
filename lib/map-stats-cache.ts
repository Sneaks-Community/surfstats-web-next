import 'server-only';
import { mapCachedFetch } from './map-cached-fetch';
import type { RefreshOptions } from './cached-fetch';
import pool from './db';
import analyticsPool, { isAnalyticsAvailable } from './db-analytics';
import type { RowDataPacket } from 'mysql2';
import { getMapMetadataFromCache } from './map-cache';
import { isStagedMap } from './utils';
import { validateMapName } from './validators';

// Safety net only; the 24h precache sweep keeps it fresh. At 1x, maps late in each sweep would
// sit expired and their next visitor would pay for six aggregates.
const STATS_CACHE_TTL = 259200; // 72 hours = 3x the sweep interval

/** Five of the six per-map chart series; the sixth is {@link wrCheckpointSuffix}. */
export const MAP_STATS_SUFFIXES = {
  completions: 'stats:completions',
  timeOnMap: 'stats:time-on-map',
  checkpoints: 'stats:checkpoints',
  bonusTime: 'stats:bonus-time',
  percentiles: 'stats:percentiles',
} as const;

/** The sixth series, keyed per checkpoint count. */
export function wrCheckpointSuffix(maxCheckpoint: number): string {
  return `stats:wr-checkpoint:${maxCheckpoint}`;
}

// Every fetcher here is an aggregate, so all pass `expensive: true`; otherwise the precache
// floods the 20-connection pool while page renders wait.

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

// `cp1..cpN`, bounded here because callers interpolate these names into SQL.
function checkpointColumns(maxCheckpoint: number): string[] {
  if (maxCheckpoint > 75 || maxCheckpoint < 0) {
    throw new Error('Invalid checkpoint count');
  }
  return Array.from({ length: maxCheckpoint }, (_, i) => `cp${i + 1}`);
}

// Average time and sample size per checkpoint, across all players' rows.
function processCheckpointData(
  checkpointRows: RowDataPacket[],
  maxCheckpoint: number
): CheckpointStatsResult {
  const checkpointStats = new Map<number, { totalTime: number; sampleSize: number }>();

  for (const row of checkpointRows) {
    for (let i = 1; i <= maxCheckpoint; i++) {
      const colName = `cp${i}` as keyof typeof row;
      const cpTime = row[colName];

      if (cpTime !== null && cpTime !== undefined) {
        if (!checkpointStats.has(i)) {
          checkpointStats.set(i, { totalTime: 0, sampleSize: 0 });
        }
        const stats = checkpointStats.get(i);
        if (stats) {
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

export async function getWRCheckpointTimesFromCache(
  mapname: string,
  maxCheckpoint: number,
  { force = false }: RefreshOptions = {}
): Promise<Array<{ checkpoint: number; time: number }> | undefined> {
  if (maxCheckpoint === 0) {
    return undefined;
  }

  return mapCachedFetch<Array<{ checkpoint: number; time: number }> | undefined>({
    mapname,
    keySuffix: wrCheckpointSuffix(maxCheckpoint),
    ttl: STATS_CACHE_TTL,
    force,
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

      const columns = checkpointColumns(maxCheckpoint);

      const [wrCheckpointRows] = await pool.query<RowDataPacket[]>(`
        SELECT ${columns.join(', ')}
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

export async function getCheckpointStatsFromCache(
  mapname: string,
  { force = false }: RefreshOptions = {}
): Promise<CheckpointStatsResult> {
  return mapCachedFetch<CheckpointStatsResult>({
    mapname,
    keySuffix: MAP_STATS_SUFFIXES.checkpoints,
    ttl: STATS_CACHE_TTL,
    force,
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

      const columns = checkpointColumns(maxCheckpoint);

      const [checkpointRows] = await pool.query<RowDataPacket[]>(`
        SELECT ${columns.join(', ')}
        FROM ck_checkpoints
        WHERE mapname = ?
      `, [validMapname]);

      return processCheckpointData(checkpointRows, maxCheckpoint);
    },
  });
}

export async function getBonusCompletionsOverTimeFromCache(
  mapname: string,
  { force = false }: RefreshOptions = {}
): Promise<Record<number, Array<{ date: string; count: number }>>> {
  return mapCachedFetch<Record<number, Array<{ date: string; count: number }>>>({
    mapname,
    keySuffix: MAP_STATS_SUFFIXES.bonusTime,
    ttl: STATS_CACHE_TTL,
    force,
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

export async function getCompletionsOverTimeFromCache(
  mapname: string,
  { force = false }: RefreshOptions = {}
): Promise<Array<{ date: string; count: number }>> {
  return mapCachedFetch<Array<{ date: string; count: number }>>({
    mapname,
    keySuffix: MAP_STATS_SUFFIXES.completions,
    ttl: STATS_CACHE_TTL,
    force,
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
 * Short-circuits while the optional analytics DB is absent or unhealthy, so no render or sweep
 * tries a doomed connection. That empty result is uncached, so the chart refills on recovery.
 */
export async function getTimeOnMapDataFromCache(
  mapname: string,
  { force = false }: RefreshOptions = {}
): Promise<Array<{ date: string; totalDuration: number }>> {
  if (!isAnalyticsAvailable()) {
    return [];
  }

  return mapCachedFetch<Array<{ date: string; totalDuration: number }>>({
    mapname,
    keySuffix: MAP_STATS_SUFFIXES.timeOnMap,
    ttl: STATS_CACHE_TTL,
    force,
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

/** Percentiles via LIMIT/OFFSET, for MariaDB compatibility. */
export async function getPercentileTimesFromCache(
  mapname: string,
  { force = false }: RefreshOptions = {}
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
    force,
    empty: null,
    errorLabel: 'percentile times',
    expensive: true,
    errorLevel: 'warn',
    fetch: async (validMapname) => {
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

      // 0-indexed row offsets for `LIMIT 1 OFFSET ?`.
      const p1Offset = Math.max(0, Math.floor(totalCount * 0.01));
      const p10Offset = Math.max(0, Math.floor(totalCount * 0.10));
      const medianOffset = Math.max(0, Math.floor(totalCount * 0.50));

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

/** A map's stats-grid data, rendered server-side and passed to MapChartGrid as props. */
export interface MapChartData {
  completionsOverTime: Array<{ date: string; count: number }>;
  timeOnMapData: Array<{ date: string; totalDuration: number }>;
  checkpointAvgTimes: Array<{ checkpoint: number; avgTime: number; sampleSize: number }>;
  wrCheckpointTimes?: Array<{ checkpoint: number; time: number }>;
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
 * Composes {@link MapChartData} from the map's cached series.
 * Empty series (but the correct `isStageMap`) for maps with no completions.
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

  // Completions, checkpoints and stages come from the cached metadata, not a query.
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
    bonusCompletionsOverTime,
    percentileTimes,
  ] = await Promise.all([
    getCompletionsOverTimeFromCache(validMapname),
    getTimeOnMapDataFromCache(validMapname),
    getCheckpointStatsFromCache(validMapname),
    getWRCheckpointTimesFromCache(validMapname, maxCheckpoint),
    getBonusCompletionsOverTimeFromCache(validMapname),
    getPercentileTimesFromCache(validMapname),
  ]);

  return {
    completionsOverTime,
    timeOnMapData,
    checkpointAvgTimes,
    wrCheckpointTimes,
    bonusCompletionsOverTime,
    isStageMap,
    percentileTimes,
  };
}
