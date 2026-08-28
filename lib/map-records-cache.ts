import 'server-only';
import { mapCachedFetch } from './map-cached-fetch';
import pool from './db';
import type { RowDataPacket } from 'mysql2';
import { withTimeout } from './timeout';

/**
 * Every paginated/ranked query here orders by `runtime…, date ASC, steamid ASC`.
 * Without a tiebreak, rows sharing a time have no guaranteed order, so a player
 * can appear on two pages or on none as the plan or the data shifts. `steamid` is
 * unique per (map[, zonegroup]), so the three keys are a total order; `date`
 * comes first to match the "earliest run wins" rule the WR tiebreak uses.
 *
 * The stage queries instead use `DENSE_RANK` over `runtime, date`, where ties
 * deliberately *share* a rank — do not add `steamid` to those windows.
 */
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
 * Get record counts and WR time from cache. One round trip: four scalar
 * subqueries over the map's rows.
 */
export async function getRecordCountsAndWRFromCache(mapname: string): Promise<CountsAndWr> {
  return mapCachedFetch<CountsAndWr>({
    mapname,
    keySuffix: 'counts',
    ttl: RECORDS_COUNTS_TTL,
    empty: { counts: { leaderboardTotal: 0, bonusesTotal: 0, stagesTotal: 0 }, wr_time: null },
    errorLabel: 'counts and WR',
    expensive: true,
    fetch: async (validMapname) => {
      const [countsRows] = await withTimeout(
        pool.query<RowDataPacket[]>(`
          SELECT
            (SELECT COUNT(*) FROM ck_playertimes WHERE mapname = ?) as leaderboardTotal,
            (SELECT COUNT(*) FROM ck_bonus WHERE mapname = ?) as bonusesTotal,
            (SELECT COUNT(*) FROM ck_stages WHERE \`map\` = ?) as stagesTotal,
            (SELECT MIN(runtimepro) FROM ck_playertimes WHERE mapname = ?) as wr_time
        `, [validMapname, validMapname, validMapname, validMapname]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      const counts: RecordCounts = {
        leaderboardTotal: countsRows[0]?.leaderboardTotal || 0,
        bonusesTotal: countsRows[0]?.bonusesTotal || 0,
        stagesTotal: countsRows[0]?.stagesTotal || 0,
      };

      return { counts, wr_time: countsRows[0]?.wr_time || null };
    },
  });
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
  const offset = (page - 1) * pageSize;

  return mapCachedFetch<LeaderboardResult>({
    mapname,
    keySuffix: `leaderboard:${page}:${pageSize}`,
    ttl: RECORDS_CACHE_TTL,
    empty: { records: [], wr_time: null },
    errorLabel: 'leaderboard records',
    expensive: true,
    fetch: async (validMapname) => {
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
            ROW_NUMBER() OVER (ORDER BY runtimepro ASC, date ASC, steamid ASC) as \`rank\`,
            ? as wr_time
          FROM ck_playertimes
          WHERE mapname = ?
          ORDER BY runtimepro ASC, date ASC, steamid ASC
          LIMIT ? OFFSET ?
        `, [localWrTime, validMapname, pageSize, offset]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      return { records: leaderboardRows, wr_time: localWrTime };
    },
  });
}

/**
 * Get stage records from cache
 */
export async function getStageRecordsFromCache(
  mapname: string,
  stage: number,
  page: number,
  pageSize: number
): Promise<StageRecordsResult> {
  const offset = (page - 1) * pageSize;

  // Row data is always the rank-ordered top-100 per (map, stage); sort/page are
  // applied client-side. Cache only that expensive slice, keyed by stage alone.
  const { stages, total } = await mapCachedFetch<{ stages: StageRecord[]; total: number }>({
    mapname,
    keySuffix: `stages:${stage}`,
    ttl: STAGES_CACHE_TTL,
    empty: { stages: [], total: 0 },
    errorLabel: 'stage records',
    expensive: true,
    fetch: async (validMapname) => {
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
      return {
        stages: stageRows,
        total: Math.min(totalWithRank, MAX_STAGE_RECORDS),
      };
    },
  });

  return {
    stages,
    pagination: {
      stage,
      page,
      pageSize,
      offset,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
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

  return mapCachedFetch<BonusRecordsResult>({
    mapname,
    keySuffix: `bonuses:${bonus}:${page}:${pageSize}`,
    ttl: BONUSES_CACHE_TTL,
    empty: { bonuses: [], pagination: emptyPagination },
    errorLabel: 'bonus records',
    expensive: true,
    fetch: async (validMapname) => {
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
            ROW_NUMBER() OVER (ORDER BY b.runtime ASC, b.date ASC, b.steamid ASC) as \`rank\`,
            (SELECT MIN(runtime) FROM ck_bonus WHERE mapname = b.mapname AND zonegroup = b.zonegroup) as wr_time
          FROM ck_bonus b
          WHERE b.mapname = ? AND b.zonegroup = ?
          ORDER BY b.runtime ASC, b.date ASC, b.steamid ASC
          LIMIT ? OFFSET ?
        `, [validMapname, bonus, pageSize, offset]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      return {
        bonuses: bonusRows,
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
  });
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
  const normalizedQuery = query.toLowerCase();
  const likePattern = `%${normalizedQuery}%`;

  return mapCachedFetch<LeaderboardResult>({
    mapname,
    keySuffix: `search:${normalizedQuery}`,
    ttl: SEARCH_CACHE_TTL,
    empty: { records: [], wr_time: null },
    errorLabel: `search results (query "${query}")`,
    expensive: true,
    fetch: async (validMapname) => {
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
                    ROW_NUMBER() OVER (ORDER BY runtimepro ASC, date ASC, steamid ASC) AS \`rank\`
             FROM ck_playertimes
             WHERE mapname = ?
           ) ranked
           WHERE ranked.name LIKE ? OR ranked.steamid LIKE ?
           ORDER BY ranked.runtimepro ASC, ranked.date ASC, ranked.steamid ASC
           LIMIT ?`,
          [wr_time, validMapname, likePattern, likePattern, SEARCH_MAX_RESULTS]
        ),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      return { records: rows, wr_time };
    },
  });
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
  const normalizedQuery = query.toLowerCase();
  const likePattern = `%${normalizedQuery}%`;

  return mapCachedFetch<{ stages: StageRecord[] }>({
    mapname,
    keySuffix: `stage:${stage}:search:${normalizedQuery}`,
    ttl: SEARCH_CACHE_TTL,
    empty: { stages: [] },
    errorLabel: `stage ${stage} search results (query "${query}")`,
    expensive: true,
    fetch: async (validMapname) => {
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
  });
}

/**
 * Search bonus records by player name or SteamID for a specific bonus zone.
 */
export async function searchBonusRecordsFromCache(
  mapname: string,
  bonus: number,
  query: string
): Promise<{ records: BonusRecord[] }> {
  const normalizedQuery = query.toLowerCase();
  const likePattern = `%${normalizedQuery}%`;

  return mapCachedFetch<{ records: BonusRecord[] }>({
    mapname,
    keySuffix: `bonus:${bonus}:search:${normalizedQuery}`,
    ttl: SEARCH_CACHE_TTL,
    empty: { records: [] },
    errorLabel: `bonus ${bonus} search results (query "${query}")`,
    expensive: true,
    fetch: async (validMapname) => {
      const [rows] = await withTimeout(
        pool.query<BonusRecord[]>(
          `SELECT ranked.steamid, ranked.name, ranked.zonegroup, ranked.runtime, ranked.date, ranked.startspeed,
                  ranked.\`rank\`,
                  (SELECT MIN(runtime) FROM ck_bonus WHERE mapname = ? AND zonegroup = ranked.zonegroup) AS wr_time
           FROM (
             SELECT b.steamid, b.name, b.zonegroup, b.runtime, b.date, b.startspeed,
                    ROW_NUMBER() OVER (ORDER BY b.runtime ASC, b.date ASC, b.steamid ASC) AS \`rank\`
             FROM ck_bonus b
             WHERE b.mapname = ? AND b.zonegroup = ?
           ) ranked
           WHERE ranked.name LIKE ? OR ranked.steamid LIKE ?
           ORDER BY ranked.runtime ASC, ranked.date ASC, ranked.steamid ASC
           LIMIT ?`,
          [validMapname, validMapname, bonus, likePattern, likePattern, SEARCH_MAX_RESULTS]
        ),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      return { records: rows };
    },
  });
}
