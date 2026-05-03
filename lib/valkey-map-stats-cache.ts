import 'server-only';
import { cacheGet, cacheSet } from './valkey-cache';
import pool from './db';
import analyticsPool from './db-analytics';
import type { RowDataPacket } from 'mysql2';
import { getMapMetadataFromCache } from './valkey-map-cache';
import { validateMapName } from './validators';
import logger from './logger';

const STATS_CACHE_TTL = 43200; // 12 hours

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

  const validMapname = validateMapName(mapname);
  if (!validMapname) {
    logger.warn(`[Cache] Invalid map name: ${mapname}`);
    return undefined;
  }
  const key = `surfstats:map:${validMapname}:stats:wr-checkpoint:${maxCheckpoint}`;

  const cached = await cacheGet<Array<{ checkpoint: number; time: number }>>(key);
  if (cached !== null) {
    logger.debug(`[Cache] Hit: ${key}`);
    return cached;
  }

  logger.debug(`[Cache] Miss: ${key}`);

  try {
    const mapMetadata = await getMapMetadataFromCache(validMapname);
    const wrSteamid = mapMetadata?.wr_holder_steamid || null;

    if (!wrSteamid) {
      const result = undefined;
      await cacheSet(key, result, STATS_CACHE_TTL);
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
      const result = undefined;
      await cacheSet(key, result, STATS_CACHE_TTL);
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

    await cacheSet(key, checkpointData, STATS_CACHE_TTL);
    logger.debug(`[Cache] SET ${key} with TTL ${STATS_CACHE_TTL}s`);

    return checkpointData;
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.warn(`[Cache] Failed to fetch WR checkpoint times for ${mapname}: ${err.message || 'Unknown error'}`);
    return undefined;
  }
}

/**
 * Get checkpoint stats from cache
 */
export async function getCheckpointStatsFromCache(mapname: string): Promise<CheckpointStatsResult> {
  const validMapname = validateMapName(mapname);
  if (!validMapname) {
    logger.warn(`[Cache] Invalid map name: ${mapname}`);
    return { checkpointAvgTimes: [] };
  }
  const key = `surfstats:map:${validMapname}:stats:checkpoints`;

  const cached = await cacheGet<CheckpointStatsResult>(key);
  if (cached !== null) {
    logger.debug(`[Cache] Hit: ${key}`);
    return cached;
  }

  logger.debug(`[Cache] Miss: ${key}`);

  try {
    const mapMetadata = await getMapMetadataFromCache(validMapname);
    const checkpoints = mapMetadata?.checkpoints || 0;
    const stages = mapMetadata?.stages || 0;
    const maxCheckpoint = checkpoints > 0 ? checkpoints : stages;

    if (maxCheckpoint === 0) {
      const result: CheckpointStatsResult = { checkpointAvgTimes: [] };
      await cacheSet(key, result, STATS_CACHE_TTL);
      return result;
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

    const result = processCheckpointData(checkpointRows, maxCheckpoint);

    await cacheSet(key, result, STATS_CACHE_TTL);
    logger.debug(`[Cache] SET ${key} with TTL ${STATS_CACHE_TTL}s`);

    return result;
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.warn(`[Cache] Failed to fetch checkpoint stats for ${mapname}: ${err.message || 'Unknown error'}`);
    return { checkpointAvgTimes: [] };
  }
}

/**
 * Get bonus completions over time from cache
 */
export async function getBonusCompletionsOverTimeFromCache(
  mapname: string
): Promise<Record<number, Array<{ date: string; count: number }>>> {
  const validMapname = validateMapName(mapname);
  if (!validMapname) {
    logger.warn(`[Cache] Invalid map name: ${mapname}`);
    return {};
  }
  const key = `surfstats:map:${validMapname}:stats:bonus-time`;

  const cached = await cacheGet<Record<number, Array<{ date: string; count: number }>>>(key);
  if (cached !== null) {
    logger.debug(`[Cache] Hit: ${key}`);
    return cached;
  }

  logger.debug(`[Cache] Miss: ${key}`);

  try {
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

    await cacheSet(key, bonusData, STATS_CACHE_TTL);
    logger.debug(`[Cache] SET ${key} with TTL ${STATS_CACHE_TTL}s`);

    return bonusData;
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.warn(`[Cache] Failed to fetch bonus completions over time for ${mapname}: ${err.message || 'Unknown error'}`);
    return {};
  }
}

/**
 * Get completions over time from cache
 */
export async function getCompletionsOverTimeFromCache(mapname: string): Promise<Array<{ date: string; count: number }>> {
  const validMapname = validateMapName(mapname);
  if (!validMapname) {
    logger.warn(`[Cache] Invalid map name: ${mapname}`);
    return [];
  }
  const key = `surfstats:map:${validMapname}:stats:completions`;

  const cached = await cacheGet<Array<{ date: string; count: number }>>(key);
  if (cached !== null) {
    logger.debug(`[Cache] Hit: ${key}`);
    return cached;
  }

  logger.debug(`[Cache] Miss: ${key}`);

  try {
    const [completionsRows] = await pool.query<CompletionsOverTimeData[]>(`
      SELECT
        DATE_FORMAT(date, '%Y-%m-01') as date,
        COUNT(*) as count
      FROM ck_playertimes
      WHERE mapname = ?
      GROUP BY DATE_FORMAT(date, '%Y-%m')
      ORDER BY date ASC
    `, [validMapname]);

    const result = completionsRows.map(row => ({
      date: row.date,
      count: row.count,
    }));

    await cacheSet(key, result, STATS_CACHE_TTL);
    logger.debug(`[Cache] SET ${key} with TTL ${STATS_CACHE_TTL}s`);

    return result;
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.warn(`[Cache] Failed to fetch completions over time for ${mapname}: ${err.message || 'Unknown error'}`);
    return [];
  }
}

/**
 * Get time on map data from cache
 */
export async function getTimeOnMapDataFromCache(mapname: string): Promise<Array<{ date: string; totalDuration: number }>> {
  const validMapname = validateMapName(mapname);
  if (!validMapname) {
    logger.warn(`[Cache] Invalid map name: ${mapname}`);
    return [];
  }
  const key = `surfstats:map:${validMapname}:stats:time-on-map`;

  const cached = await cacheGet<Array<{ date: string; totalDuration: number }>>(key);
  if (cached !== null) {
    logger.debug(`[Cache] Hit: ${key}`);
    return cached;
  }

  logger.debug(`[Cache] Miss: ${key}`);

  try {
    let timeOnMapData: Array<{ date: string; totalDuration: number }> = [];

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
    timeOnMapData = timeOnMapRows.map(row => {
      const hours = (row.total_duration || 0) / 3600;
      cumulativeTotalHours += hours;
      return {
        date: row.date,
        totalDuration: cumulativeTotalHours,
      };
    });

    await cacheSet(key, timeOnMapData, STATS_CACHE_TTL);
    logger.debug(`[Cache] SET ${key} with TTL ${STATS_CACHE_TTL}s`);

    return timeOnMapData;
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.warn(`[Cache] Failed to fetch time on map data for ${mapname}: ${err.message || 'Unknown error'}`);
    return [];
  }
}

/**
 * Get finish time data from cache
 */
export async function getFinishTimeDataFromCache(mapname: string): Promise<{ avgTime: number | null; wrTime: number | null }> {
  const validMapname = validateMapName(mapname);
  if (!validMapname) {
    logger.warn(`[Cache] Invalid map name: ${mapname}`);
    return { avgTime: null, wrTime: null };
  }
  const key = `surfstats:map:${validMapname}:stats:finish-time`;

  const cached = await cacheGet<{ avgTime: number | null; wrTime: number | null }>(key);
  if (cached !== null) {
    logger.debug(`[Cache] Hit: ${key}`);
    return cached;
  }

  logger.debug(`[Cache] Miss: ${key}`);

  try {
    const [finishRows] = await pool.query<RowDataPacket[]>(`
      SELECT
        AVG(runtimepro) as avgTime,
        MIN(runtimepro) as wrTime
      FROM ck_playertimes
      WHERE mapname = ?
    `, [validMapname]);

    const avgTime = finishRows[0]?.avgTime || null;
    const wrTime = finishRows[0]?.wrTime || null;

    const result = {
      avgTime: avgTime ? Number(avgTime) : null,
      wrTime: wrTime ? Number(wrTime) : null,
    };

    await cacheSet(key, result, STATS_CACHE_TTL);
    logger.debug(`[Cache] SET ${key} with TTL ${STATS_CACHE_TTL}s`);

    return result;
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.warn(`[Cache] Failed to fetch finish time data for ${mapname}: ${err.message || 'Unknown error'}`);
    return { avgTime: null, wrTime: null };
  }
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
  const validMapname = validateMapName(mapname);
  if (!validMapname) {
    logger.warn(`[Cache] Invalid map name: ${mapname}`);
    return null;
  }
  const key = `surfstats:map:${validMapname}:stats:percentiles`;

  const cached = await cacheGet<{
    wrTime: number | null;
    p1Time: number | null;
    p10Time: number | null;
    medianTime: number | null;
    avgTime: number | null;
  }>(key);
  if (cached !== null) {
    logger.debug(`[Cache] Hit: ${key}`);
    return cached;
  }

  logger.debug(`[Cache] Miss: ${key}`);

  try {
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
      const result = { wrTime: null, p1Time: null, p10Time: null, medianTime: null, avgTime: null };
      await cacheSet(key, result, STATS_CACHE_TTL);
      logger.debug(`[Cache] SET ${key} with TTL ${STATS_CACHE_TTL}s`);
      return result;
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

    const result = {
      wrTime: summary.wrTime ? Number(summary.wrTime) : null,
      p1Time: p1Rows[0].runtimepro ? Number(p1Rows[0].runtimepro) : null,
      p10Time: p10Rows[0].runtimepro ? Number(p10Rows[0].runtimepro) : null,
      medianTime: medianRows[0].runtimepro ? Number(medianRows[0].runtimepro) : null,
      avgTime: summary.avgTime ? Number(summary.avgTime) : null,
    };

    await cacheSet(key, result, STATS_CACHE_TTL);
    logger.debug(`[Cache] SET ${key} with TTL ${STATS_CACHE_TTL}s`);

    return result;
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.warn(`[Cache] Failed to fetch percentile times for ${mapname}: ${err.message || 'Unknown error'}`);
    return null;
  }
}
