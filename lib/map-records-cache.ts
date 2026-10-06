import 'server-only';
import { mapCachedFetch } from './map-cached-fetch';
import pool from './db';
import type { RowDataPacket } from 'mysql2';

// Paginated queries order by `runtime, date, steamid`: steamid is unique per map/zonegroup, so tied
// times never skip or repeat across pages, and date first matches the earliest-run-wins WR rule.
// Stage DENSE_RANK ties deliberately share a rank: do not add `steamid` to those windows.
const RECORDS_CACHE_TTL = 300; // 5 minutes
const RECORDS_COUNTS_TTL = 300; // 5 minutes
const STAGES_CACHE_TTL = 300; // 5 minutes
const BONUSES_CACHE_TTL = 300; // 5 minutes

interface RecordCounts {
  leaderboardTotal: number;
  bonusesTotal: number;
  stagesTotal: number;
}

export interface MapRecord {
  steamid: string;
  name: string;
  runtimepro: number;
  date: string;
  rank: number;
  wr_time: number | null;
  startspeed: number;
}

export interface BonusRecord {
  steamid: string;
  name: string;
  zonegroup: number;
  runtime: number;
  date: string;
  rank: number;
  wr_time: number | null;
  startspeed: number;
}

export interface StageRecord {
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

/** One round trip: four scalar subqueries over the map's rows. */
export async function getRecordCountsAndWRFromCache(mapname: string): Promise<CountsAndWr> {
  return mapCachedFetch<CountsAndWr>({
    mapname,
    keySuffix: 'counts',
    ttl: RECORDS_COUNTS_TTL,
    empty: { counts: { leaderboardTotal: 0, bonusesTotal: 0, stagesTotal: 0 }, wr_time: null },
    errorLabel: 'counts and WR',
    expensive: true,
    fetch: async (validMapname) => {
      const [countsRows] = await pool.query<RowDataPacket[]>(`
        SELECT
          (SELECT COUNT(*) FROM ck_playertimes WHERE mapname = ?) as leaderboardTotal,
          (SELECT COUNT(*) FROM ck_bonus WHERE mapname = ?) as bonusesTotal,
          (SELECT COUNT(*) FROM ck_stages WHERE \`map\` = ?) as stagesTotal,
          (SELECT MIN(runtimepro) FROM ck_playertimes WHERE mapname = ?) as wr_time
      `, [validMapname, validMapname, validMapname, validMapname]);

      const counts: RecordCounts = {
        leaderboardTotal: countsRows[0]?.leaderboardTotal || 0,
        bonusesTotal: countsRows[0]?.bonusesTotal || 0,
        stagesTotal: countsRows[0]?.stagesTotal || 0,
      };

      return { counts, wr_time: countsRows[0]?.wr_time || null };
    },
  });
}

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
        const [wrTimeRows] = await pool.query<RowDataPacket[]>(`
          SELECT MIN(runtimepro) as wr_time FROM ck_playertimes WHERE mapname = ?
        `, [validMapname]);
        localWrTime = wrTimeRows[0]?.wr_time || null;
      }

      const [leaderboardRows] = await pool.query<Array<MapRecord & RowDataPacket>>(`
        SELECT
          steamid, name, runtimepro, date, startspeed,
          ROW_NUMBER() OVER (ORDER BY runtimepro ASC, date ASC, steamid ASC) as \`rank\`,
          ? as wr_time
        FROM ck_playertimes
        WHERE mapname = ?
        ORDER BY runtimepro ASC, date ASC, steamid ASC
        LIMIT ? OFFSET ?
      `, [localWrTime, validMapname, pageSize, offset]);

      return { records: leaderboardRows, wr_time: localWrTime };
    },
  });
}

export async function getStageRecordsFromCache(
  mapname: string,
  stage: number,
  page: number,
  pageSize: number
): Promise<StageRecordsResult> {
  const offset = (page - 1) * pageSize;

  // Caches only the expensive rank-ordered top 100, keyed by stage alone; sort and page are
  // applied client-side.
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
        pool.query<RowDataPacket[]>(`
          SELECT MIN(runtime) as wr_time FROM ck_stages WHERE map = ? AND stage = ?
        `, [validMapname, stage]),
        pool.query<RowDataPacket[]>(`
          SELECT COUNT(DISTINCT \`rank\`) as total FROM (
            SELECT
              s.steamid,
              DENSE_RANK() OVER (ORDER BY s.runtime ASC, s.date ASC) as \`rank\`
            FROM ck_stages s
            WHERE s.map = ? AND s.stage = ?
          ) AS ranked
        `, [validMapname, stage])
      ]);

      const [wrRows] = wrResult;
      const [rankCountRows] = rankCountResult;

      const wrTime = wrRows[0]?.wr_time || null;

      const [stageRows] = await pool.query<Array<StageRecord & RowDataPacket>>(`
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
      `, [wrTime, validMapname, stage, MAX_STAGE_RECORDS]);

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
      const [countRows] = await pool.query<RowDataPacket[]>(`
        SELECT COUNT(*) as total FROM ck_bonus WHERE mapname = ? AND zonegroup = ?
      `, [validMapname, bonus]);
      const totalRecords = countRows[0]?.total || 0;

      const [bonusRows] = await pool.query<Array<BonusRecord & RowDataPacket>>(`
        SELECT
          b.steamid, b.name, b.zonegroup, b.runtime, b.date, b.startspeed,
          ROW_NUMBER() OVER (ORDER BY b.runtime ASC, b.date ASC, b.steamid ASC) as \`rank\`,
          (SELECT MIN(runtime) FROM ck_bonus WHERE mapname = b.mapname AND zonegroup = b.zonegroup) as wr_time
        FROM ck_bonus b
        WHERE b.mapname = ? AND b.zonegroup = ?
        ORDER BY b.runtime ASC, b.date ASC, b.steamid ASC
        LIMIT ? OFFSET ?
      `, [validMapname, bonus, pageSize, offset]);

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

const SEARCH_CACHE_TTL = 60; // 1 minute; short, since results vary per query
const SEARCH_MAX_RESULTS = 100;

/** Name or SteamID search over all completions, not just loaded pages; ranks stay global. */
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
      const [wrRows] = await pool.query<RowDataPacket[]>(
        `SELECT MIN(runtimepro) as wr_time FROM ck_playertimes WHERE mapname = ?`,
        [validMapname]
      );
      const wr_time: number | null = wrRows[0]?.wr_time ?? null;

      const [rows] = await pool.query<Array<MapRecord & RowDataPacket>>(
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
      );

      return { records: rows, wr_time };
    },
  });
}

/** Name or SteamID search; DENSE_RANK runs over all stage completions before the LIKE filter. */
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
      const [wrRows] = await pool.query<RowDataPacket[]>(
        `SELECT MIN(runtime) AS wr_time FROM ck_stages WHERE map = ? AND stage = ?`,
        [validMapname, stage]
      );
      const wr_time: number | null = wrRows[0]?.wr_time ?? null;

      const [rows] = await pool.query<Array<StageRecord & RowDataPacket>>(
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
      );

      return { stages: rows };
    },
  });
}

/** Name or SteamID search within one bonus zone. */
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
      const [rows] = await pool.query<Array<BonusRecord & RowDataPacket>>(
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
      );

      return { records: rows };
    },
  });
}
