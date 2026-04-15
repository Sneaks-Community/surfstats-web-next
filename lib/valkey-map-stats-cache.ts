import 'server-only';
import { cacheGet, cacheSet } from './valkey-cache';
import pool from './db';
import analyticsPool from './db-analytics';
import type { RowDataPacket } from 'mysql2';
import { getMapMetadata } from './map-cache';
import { sanitizeMapName } from './sanitize';
import logger from './logger';

const STATS_CACHE_TTL = 3600; // 1 hour

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
        const stats = checkpointStats.get(i)!;
        stats.reached += 1;
        stats.totalTime += cpTime as number;
        stats.sampleSize += 1;
      }
    }
  }

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
 * Get WR checkpoint times from cache
 */
export async function getWRCheckpointTimesFromCache(
  mapname: string,
  maxCheckpoint: number
): Promise<Array<{ checkpoint: number; time: number }> | undefined> {
  if (maxCheckpoint === 0) {
    return undefined;
  }

  const validMapname = sanitizeMapName(mapname);
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
    const mapMetadata = await getMapMetadata(validMapname);
    const wrSteamid = mapMetadata?.wr_holder_steamid || null;

    if (!wrSteamid) {
      const result: undefined = undefined;
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
      const result: undefined = undefined;
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
 * Get bonus completion rates from cache
 */
export async function getBonusCompletionRatesFromCache(
  mapname: string,
  totalCompletions: number
): Promise<Array<{ bonus: number; completionRate: number; completions: number }>> {
  const validMapname = sanitizeMapName(mapname);
  if (!validMapname) {
    logger.warn(`[Cache] Invalid map name: ${mapname}`);
    return [];
  }
  const key = `surfstats:map:${validMapname}:stats:bonus-rates:${totalCompletions}`;

  const cached = await cacheGet<Array<{ bonus: number; completionRate: number; completions: number }>>(key);
  if (cached !== null) {
    logger.debug(`[Cache] Hit: ${key}`);
    return cached;
  }

  logger.debug(`[Cache] Miss: ${key}`);

  try {
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

    const result = bonusRows.map(row => ({
      bonus: row.bonus,
      completionRate: row.completions / row.total,
      completions: row.completions,
    }));

    await cacheSet(key, result, STATS_CACHE_TTL);
    logger.debug(`[Cache] SET ${key} with TTL ${STATS_CACHE_TTL}s`);

    return result;
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.warn(`[Cache] Failed to fetch bonus completion rates for ${mapname}: ${err.message || 'Unknown error'}`);
    return [];
  }
}

/**
 * Get checkpoint stats from cache
 */
export async function getCheckpointStatsFromCache(mapname: string): Promise<CheckpointStatsResult> {
  const validMapname = sanitizeMapName(mapname);
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
    const mapMetadata = await getMapMetadata(validMapname);
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
): Promise<{ [bonus: number]: Array<{ date: string; count: number }> }> {
  const validMapname = sanitizeMapName(mapname);
  if (!validMapname) {
    logger.warn(`[Cache] Invalid map name: ${mapname}`);
    return {};
  }
  const key = `surfstats:map:${validMapname}:stats:bonus-time`;

  const cached = await cacheGet<{ [bonus: number]: Array<{ date: string; count: number }> }>(key);
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
  const validMapname = sanitizeMapName(mapname);
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
  const validMapname = sanitizeMapName(mapname);
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
  const validMapname = sanitizeMapName(mapname);
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
