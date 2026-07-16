import 'server-only';
import { cachedFetch } from './cached-fetch';
import pool from './db';
import type { RowDataPacket } from 'mysql2';
import { validateMapName } from './validators';
import { withTimeout } from './timeout';
import logger from './logger';
import { getErrorMessage } from './errors';

const RECORDS_CACHE_TTL = 300; // 5 minutes
const RECORDS_COUNTS_TTL = 300; // 5 minutes
const STAGES_CACHE_TTL = 300; // 5 minutes
const BONUSES_CACHE_TTL = 300; // 5 minutes
const QUERY_TIMEOUT_MS = 30000; // 30 seconds

interface RecordCounts {
  leaderboardTotal: number;
  bonusesTotal: number;
  stagesTotal: number;
}

interface MapRecord extends RowDataPacket {
  steamid: string;
  name: string;
  runtimepro: number;
  date: string;
  rank: number;
  wr_time: number | null;
  startspeed: number;
}

interface BonusRecord extends RowDataPacket {
  steamid: string;
  name: string;
  zonegroup: number;
  runtime: number;
  date: string;
  rank: number;
  wr_time: number | null;
  startspeed: number;
}

interface StageRecord extends RowDataPacket {
  steamid: string;
  name: string;
  stage: number;
  runtime: number;
  date: string;
  rank: number;
  wr_time: number | null;
  startspeed: number;
}

interface BonusGroup {
  bonus: number;
  name: string;
}

interface StageGroup {
  stage: number;
  name: string;
}

interface CountsAndWr {
  counts: RecordCounts;
  wr_time: number | null;
}

interface LeaderboardResult {
  records: MapRecord[];
  wr_time: number | null;
}

interface StageRecordsResult {
  stages: StageRecord[];
  stagesList: StageGroup[];
  pagination: {
    stage: number;
    page: number;
    pageSize: number;
    offset: number;
    total: number;
    totalPages: number;
  };
}

interface BonusRecordsResult {
  bonuses: BonusRecord[];
  bonusGroupsList: BonusGroup[];
  pagination: {
    bonus: number;
    page: number;
    pageSize: number;
    offset: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Get record counts and WR time from cache
 */
export async function getRecordCountsAndWRFromCache(mapname: string): Promise<CountsAndWr> {
  const empty: CountsAndWr = { counts: { leaderboardTotal: 0, bonusesTotal: 0, stagesTotal: 0 }, wr_time: null };
  const validMapname = validateMapName(mapname);
  if (!validMapname) {
    logger.warn(`[Cache] Invalid map name: ${mapname}`);
    return empty;
  }
  const key = `surfstats:map:${validMapname}:counts`;

  return cachedFetch<CountsAndWr>(
    key,
    RECORDS_COUNTS_TTL,
    async () => {
      const [countsRows] = await withTimeout(
        pool.query<RowDataPacket[]>(`
          SELECT
            (SELECT COUNT(*) FROM ck_playertimes WHERE mapname = ?) as leaderboardTotal,
            (SELECT COUNT(*) FROM ck_bonus WHERE mapname = ?) as bonusesTotal,
            (SELECT COUNT(*) FROM ck_stages WHERE \`map\` = ?) as stagesTotal
        `, [validMapname, validMapname, validMapname]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      const counts: RecordCounts = {
        leaderboardTotal: countsRows[0]?.leaderboardTotal || 0,
        bonusesTotal: countsRows[0]?.bonusesTotal || 0,
        stagesTotal: countsRows[0]?.stagesTotal || 0,
      };

      const [wrTimeRows] = await withTimeout(
        pool.query<RowDataPacket[]>(`
          SELECT MIN(runtimepro) as wr_time FROM ck_playertimes WHERE mapname = ?
        `, [validMapname]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );
      const wr_time = wrTimeRows[0]?.wr_time || null;

      return { counts, wr_time };
    },
    {
      lock: true,
      expensive: true,
      onError: (error) => {
        logger.error(`[Cache] Failed to fetch counts and WR for ${validMapname}: ${getErrorMessage(error)}`);
        return empty;
      },
    }
  );
}

/**
 * Get leaderboard records from cache
 */
export async function getLeaderboardRecordsFromCache(
  mapname: string,
  page: number,
  pageSize: number,
  wr_time: number | null = null
): Promise<LeaderboardResult> {
  const validMapname = validateMapName(mapname);
  if (!validMapname) {
    logger.warn(`[Cache] Invalid map name: ${mapname}`);
    return { records: [], wr_time: null };
  }
  const offset = (page - 1) * pageSize;
  const key = `surfstats:map:${validMapname}:leaderboard:${page}:${pageSize}`;

  return cachedFetch<LeaderboardResult>(
    key,
    RECORDS_CACHE_TTL,
    async () => {
      let localWrTime = wr_time;
      if (localWrTime === null) {
        const [wrTimeRows] = await withTimeout(
          pool.query<RowDataPacket[]>(`
            SELECT MIN(runtimepro) as wr_time FROM ck_playertimes WHERE mapname = ?
          `, [validMapname]),
          QUERY_TIMEOUT_MS,
          'Query timeout exceeded'
        );
        localWrTime = wrTimeRows[0]?.wr_time || null;
      }

      const [leaderboardRows] = await withTimeout(
        pool.query<MapRecord[]>(`
          SELECT
            steamid, name, runtimepro, date, startspeed,
            ROW_NUMBER() OVER (ORDER BY runtimepro ASC) as \`rank\`,
            ? as wr_time
          FROM ck_playertimes
          WHERE mapname = ?
          ORDER BY runtimepro ASC
          LIMIT ? OFFSET ?
        `, [localWrTime, validMapname, pageSize, offset]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      return { records: leaderboardRows, wr_time: localWrTime };
    },
    {
      lock: true,
      expensive: true,
      onError: (error) => {
        logger.error(`[Cache] Failed to fetch leaderboard records for ${validMapname}: ${getErrorMessage(error)}`);
        return { records: [], wr_time: null };
      },
    }
  );
}

/**
 * Get map records (leaderboard, counts, WR time) by composing the two
 * underlying sub-caches (counts+WR and the paginated leaderboard).
 */
export async function getMapRecordsFromCache(
  mapname: string,
  page = 1,
  pageSize = 100
): Promise<{
  leaderboard: MapRecord[];
  counts: RecordCounts;
  wr_time: number | null;
}> {
  const validMapname = validateMapName(mapname);
  if (!validMapname) {
    logger.warn(`[Cache] Invalid map name: ${mapname}`);
    return { leaderboard: [], counts: { leaderboardTotal: 0, bonusesTotal: 0, stagesTotal: 0 }, wr_time: null };
  }

  try {
    const { counts, wr_time } = await getRecordCountsAndWRFromCache(validMapname);
    const { records: leaderboard } = await getLeaderboardRecordsFromCache(validMapname, page, pageSize, wr_time);

    return {
      leaderboard,
      counts,
      wr_time,
    };
  } catch (error: unknown) {
    logger.error(`[Cache] Failed to fetch map records for ${validMapname}: ${getErrorMessage(error)}`);
    return { leaderboard: [], counts: { leaderboardTotal: 0, bonusesTotal: 0, stagesTotal: 0 }, wr_time: null };
  }
}

/**
 * Get stage records from cache
 */
export async function getStageRecordsFromCache(
  mapname: string,
  stage: number,
  sortField: string,
  sortOrder: string,
  pageSize: number,
  offset: number
): Promise<StageRecordsResult> {
  const validMapname = validateMapName(mapname);
  const emptyPagination = {
    stage,
    page: Math.floor(offset / pageSize) + 1,
    pageSize,
    offset,
    total: 0,
    totalPages: 0,
  };
  if (!validMapname) {
    logger.warn(`[Cache] Invalid map name: ${mapname}`);
    return { stages: [], stagesList: [], pagination: emptyPagination };
  }
  const key = `surfstats:map:${validMapname}:stages:${stage}:${sortField}:${sortOrder}:${pageSize}:${offset}`;

  return cachedFetch<StageRecordsResult>(
    key,
    STAGES_CACHE_TTL,
    async () => {
      const MAX_STAGE_RECORDS = 100;

      const [wrResult, rankCountResult] = await Promise.all([
        withTimeout(
          pool.query<RowDataPacket[]>(`
            SELECT MIN(runtime) as wr_time FROM ck_stages WHERE map = ? AND stage = ?
          `, [validMapname, stage]),
          QUERY_TIMEOUT_MS,
          'Query timeout exceeded'
        ),
        withTimeout(
          pool.query<RowDataPacket[]>(`
            SELECT COUNT(DISTINCT \`rank\`) as total FROM (
              SELECT
                s.steamid,
                DENSE_RANK() OVER (ORDER BY s.runtime ASC, s.date ASC) as \`rank\`
              FROM ck_stages s
              WHERE s.map = ? AND s.stage = ?
            ) AS ranked
          `, [validMapname, stage]),
          QUERY_TIMEOUT_MS,
          'Query timeout exceeded'
        )
      ]);

      const [wrRows] = wrResult;
      const [rankCountRows] = rankCountResult;

      const wrTime = wrRows[0]?.wr_time || null;

      const [stageRows] = await withTimeout(
        pool.query<StageRecord[]>(`
          SELECT
            steamid, name, stage, runtime, date, startspeed, \`rank\`, wr_time
          FROM (
            SELECT
              s.steamid,
              pr.name,
              s.stage,
              s.runtime,
              s.date,
              s.startspeed,
              DENSE_RANK() OVER (ORDER BY s.runtime ASC, s.date ASC) as \`rank\`,
              ? as wr_time
            FROM ck_stages s
            LEFT JOIN ck_playerrank pr ON s.steamid = pr.steamid
            WHERE s.map = ? AND s.stage = ?
          ) AS ranked_data
          WHERE \`rank\` <= ?
          ORDER BY \`rank\` ASC, date ASC
        `, [wrTime, validMapname, stage, MAX_STAGE_RECORDS]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      const totalWithRank = rankCountRows[0]?.total || 0;
      const cappedTotal = Math.min(totalWithRank, MAX_STAGE_RECORDS);
      const cappedTotalPages = Math.ceil(cappedTotal / pageSize);

      return {
        stages: stageRows,
        stagesList: [],
        pagination: {
          stage,
          page: Math.floor(offset / pageSize) + 1,
          pageSize,
          offset,
          total: cappedTotal,
          totalPages: cappedTotalPages,
        },
      };
    },
    {
      lock: true,
      expensive: true,
      onError: (error) => {
        logger.error(`[Cache] Failed to fetch stage records for ${validMapname}: ${getErrorMessage(error)}`);
        return { stages: [], stagesList: [], pagination: emptyPagination };
      },
    }
  );
}

/**
 * Get bonus records from cache
 */
export async function getBonusRecordsFromCache(
  mapname: string,
  bonus: number,
  page: number,
  pageSize: number
): Promise<BonusRecordsResult> {
  const offset = (page - 1) * pageSize;
  const emptyPagination = { bonus, page, pageSize, offset, total: 0, totalPages: 0 };
  const validMapname = validateMapName(mapname);
  if (!validMapname) {
    logger.warn(`[Cache] Invalid map name: ${mapname}`);
    return { bonuses: [], bonusGroupsList: [], pagination: emptyPagination };
  }
  const key = `surfstats:map:${validMapname}:bonuses:${bonus}:${page}:${pageSize}`;

  return cachedFetch<BonusRecordsResult>(
    key,
    BONUSES_CACHE_TTL,
    async () => {
      const [countRows] = await withTimeout(
        pool.query<RowDataPacket[]>(`
          SELECT COUNT(*) as total FROM ck_bonus WHERE mapname = ? AND zonegroup = ?
        `, [validMapname, bonus]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );
      const totalRecords = countRows[0]?.total || 0;

      const [bonusRows] = await withTimeout(
        pool.query<BonusRecord[]>(`
          SELECT
            b.steamid, b.name, b.zonegroup, b.runtime, b.date, b.startspeed,
            ROW_NUMBER() OVER (ORDER BY b.runtime ASC) as \`rank\`,
            (SELECT MIN(runtime) FROM ck_bonus WHERE mapname = b.mapname AND zonegroup = b.zonegroup) as wr_time
          FROM ck_bonus b
          WHERE b.mapname = ? AND b.zonegroup = ?
          ORDER BY b.runtime ASC
          LIMIT ? OFFSET ?
        `, [validMapname, bonus, pageSize, offset]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      return {
        bonuses: bonusRows,
        bonusGroupsList: [],
        pagination: {
          bonus,
          page,
          pageSize,
          offset,
          total: totalRecords,
          totalPages: Math.ceil(totalRecords / pageSize),
        },
      };
    },
    {
      lock: true,
      expensive: true,
      onError: (error) => {
        logger.error(`[Cache] Failed to fetch bonus records for ${validMapname}: ${getErrorMessage(error)}`);
        return { bonuses: [], bonusGroupsList: [], pagination: emptyPagination };
      },
    }
  );
}

const SEARCH_CACHE_TTL = 60; // 1 minute — short TTL since query results vary
const SEARCH_MAX_RESULTS = 100;

/**
 * Search leaderboard records by player name or SteamID across ALL completions for a map.
 * Bypasses pagination so results are never limited to already-loaded pages.
 */
export async function searchLeaderboardRecordsFromCache(
  mapname: string,
  query: string
): Promise<LeaderboardResult> {
  const validMapname = validateMapName(mapname);
  if (!validMapname) {
    return { records: [], wr_time: null };
  }

  const normalizedQuery = query.toLowerCase();
  const likePattern = `%${normalizedQuery}%`;
  const key = `surfstats:map:${validMapname}:search:${normalizedQuery}`;

  return cachedFetch<LeaderboardResult>(
    key,
    SEARCH_CACHE_TTL,
    async () => {
      const [wrRows] = await withTimeout(
        pool.query<RowDataPacket[]>(
          `SELECT MIN(runtimepro) as wr_time FROM ck_playertimes WHERE mapname = ?`,
          [validMapname]
        ),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );
      const wr_time: number | null = wrRows[0]?.wr_time ?? null;

      const [rows] = await withTimeout(
        pool.query<MapRecord[]>(
          `SELECT ranked.steamid, ranked.name, ranked.runtimepro, ranked.date, ranked.startspeed,
                  ranked.\`rank\`, ? AS wr_time
           FROM (
             SELECT steamid, name, runtimepro, date, startspeed,
                    ROW_NUMBER() OVER (ORDER BY runtimepro ASC) AS \`rank\`
             FROM ck_playertimes
             WHERE mapname = ?
           ) ranked
           WHERE ranked.name LIKE ? OR ranked.steamid LIKE ?
           ORDER BY ranked.runtimepro ASC
           LIMIT ?`,
          [wr_time, validMapname, likePattern, likePattern, SEARCH_MAX_RESULTS]
        ),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      return { records: rows, wr_time };
    },
    {
      lock: true,
      expensive: true,
      onError: (error) => {
        logger.error(`[Cache] Search failed for ${validMapname} query "${query}": ${getErrorMessage(error)}`);
        return { records: [], wr_time: null };
      },
    }
  );
}

/**
 * Search stage records by player name or SteamID. Ranks are computed globally
 * (DENSE_RANK over all stage completions) before the LIKE filter is applied.
 */
export async function searchStageRecordsFromCache(
  mapname: string,
  stage: number,
  query: string
): Promise<{ stages: StageRecord[] }> {
  const validMapname = validateMapName(mapname);
  if (!validMapname) return { stages: [] };

  const normalizedQuery = query.toLowerCase();
  const likePattern = `%${normalizedQuery}%`;
  const key = `surfstats:map:${validMapname}:stage:${stage}:search:${normalizedQuery}`;

  return cachedFetch<{ stages: StageRecord[] }>(
    key,
    SEARCH_CACHE_TTL,
    async () => {
      const [wrRows] = await withTimeout(
        pool.query<RowDataPacket[]>(
          `SELECT MIN(runtime) AS wr_time FROM ck_stages WHERE map = ? AND stage = ?`,
          [validMapname, stage]
        ),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );
      const wr_time: number | null = wrRows[0]?.wr_time ?? null;

      const [rows] = await withTimeout(
        pool.query<StageRecord[]>(
          `SELECT ranked.steamid, ranked.name, ranked.stage, ranked.runtime, ranked.date, ranked.startspeed,
                  ranked.\`rank\`, ? AS wr_time
           FROM (
             SELECT s.steamid, pr.name, s.stage, s.runtime, s.date, s.startspeed,
                    DENSE_RANK() OVER (ORDER BY s.runtime ASC, s.date ASC) AS \`rank\`
             FROM ck_stages s
             LEFT JOIN ck_playerrank pr ON s.steamid = pr.steamid
             WHERE s.map = ? AND s.stage = ?
           ) ranked
           WHERE ranked.name LIKE ? OR ranked.steamid LIKE ?
           ORDER BY ranked.\`rank\` ASC, ranked.date ASC
           LIMIT ?`,
          [wr_time, validMapname, stage, likePattern, likePattern, SEARCH_MAX_RESULTS]
        ),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      return { stages: rows };
    },
    {
      lock: true,
      expensive: true,
      onError: (error) => {
        logger.error(`[Cache] Stage search failed for ${validMapname} stage ${stage} query "${query}": ${getErrorMessage(error)}`);
        return { stages: [] };
      },
    }
  );
}

/**
 * Search bonus records by player name or SteamID for a specific bonus zone.
 */
export async function searchBonusRecordsFromCache(
  mapname: string,
  bonus: number,
  query: string
): Promise<{ records: BonusRecord[] }> {
  const validMapname = validateMapName(mapname);
  if (!validMapname) {
    return { records: [] };
  }

  const normalizedQuery = query.toLowerCase();
  const likePattern = `%${normalizedQuery}%`;
  const key = `surfstats:map:${validMapname}:bonus:${bonus}:search:${normalizedQuery}`;

  return cachedFetch<{ records: BonusRecord[] }>(
    key,
    SEARCH_CACHE_TTL,
    async () => {
      const [rows] = await withTimeout(
        pool.query<BonusRecord[]>(
          `SELECT ranked.steamid, ranked.name, ranked.zonegroup, ranked.runtime, ranked.date, ranked.startspeed,
                  ranked.\`rank\`,
                  (SELECT MIN(runtime) FROM ck_bonus WHERE mapname = ? AND zonegroup = ranked.zonegroup) AS wr_time
           FROM (
             SELECT b.steamid, b.name, b.zonegroup, b.runtime, b.date, b.startspeed,
                    ROW_NUMBER() OVER (ORDER BY b.runtime ASC) AS \`rank\`
             FROM ck_bonus b
             WHERE b.mapname = ? AND b.zonegroup = ?
           ) ranked
           WHERE ranked.name LIKE ? OR ranked.steamid LIKE ?
           ORDER BY ranked.runtime ASC
           LIMIT ?`,
          [validMapname, validMapname, bonus, likePattern, likePattern, SEARCH_MAX_RESULTS]
        ),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      return { records: rows };
    },
    {
      lock: true,
      expensive: true,
      onError: (error) => {
        logger.error(`[Cache] Bonus search failed for ${validMapname} bonus ${bonus} query "${query}": ${getErrorMessage(error)}`);
        return { records: [] };
      },
    }
  );
}
