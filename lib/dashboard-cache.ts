import 'server-only';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import logger from '@/lib/logger';
import { cachedFetch, type RefreshOptions } from './cached-fetch';
import { getErrorCode, getErrorMessage } from './errors';

// Split per key so one expired key refreshes only its own query.
const DASHBOARD_STATS_KEY = 'surfstats:dashboard:stats';
const DASHBOARD_STATS_TTL = 180; // 3x the 60s dashboard refresh

const DASHBOARD_RECENT_RECORDS_KEY = 'surfstats:dashboard:recent-records';
const DASHBOARD_RECENT_RECORDS_TTL = 180; // 3x the 60s dashboard refresh

interface DashboardStats {
  playerCount: number;
  playersMonth: number;
  mapCompletions: number;
  bonusCompletions: number;
  stageCompletions: number;
  totalPoints: number;
}

interface RecentRecords {
  steamid: string;
  name: string;
  runtime: number;
  map: string;
  date: string;
  country: string | null;
}

/** Served when the DB is unreachable. Never cached. */
const EMPTY_DASHBOARD_STATS: DashboardStats = {
  playerCount: 0,
  playersMonth: 0,
  mapCompletions: 0,
  bonusCompletions: 0,
  stageCompletions: 0,
  totalPoints: 0,
};

// Throws: the fallback belongs in the caller's `onError`, which isn't cached.
const getDashboardStatsInternal = async (): Promise<DashboardStats> => {
  const [statsRows] = await pool.query<RowDataPacket[]>('SELECT `key`, `value` FROM ck_stats');
  const statsMap = new Map<string, string>();
  statsRows.forEach((row) => {
    statsMap.set(row.key, row.value);
  });

  return {
    playerCount: parseInt(statsMap.get('player_count') || '0', 10),
    playersMonth: parseInt(statsMap.get('players_month') || '0', 10),
    mapCompletions: parseInt(statsMap.get('map_completions') || '0', 10),
    bonusCompletions: parseInt(statsMap.get('bonus_completions') || '0', 10),
    stageCompletions: parseInt(statsMap.get('stage_completions') || '0', 10),
    totalPoints: parseInt(statsMap.get('total_points') || '0', 10),
  };
};

const getRecentRecordsInternal = async (): Promise<RecentRecords[]> => {
  const [recentRecords] = await pool.query<RowDataPacket[]>(`
    SELECT lr.steamid, lr.name, lr.runtime, lr.map, lr.date, pr.country
    FROM ck_latestrecords lr
    LEFT JOIN ck_playerrank pr ON lr.steamid = pr.steamid
    ORDER BY lr.date DESC
    LIMIT 5
  `);
  return recentRecords as RecentRecords[];
};

export async function getDashboardStatsFromCache({ force }: RefreshOptions = {}): Promise<DashboardStats> {
  return cachedFetch(
    DASHBOARD_STATS_KEY,
    DASHBOARD_STATS_TTL,
    getDashboardStatsInternal,
    {
      lock: true,
      force,
      onError: (error) => {
        logger.error(`[StatsCache] Failed to fetch stats: ${getErrorMessage(error)} (code: ${getErrorCode(error)})`);
        return EMPTY_DASHBOARD_STATS;
      },
    }
  );
}

export async function getRecentRecordsFromCache({ force }: RefreshOptions = {}): Promise<RecentRecords[]> {
  return cachedFetch(
    DASHBOARD_RECENT_RECORDS_KEY,
    DASHBOARD_RECENT_RECORDS_TTL,
    getRecentRecordsInternal,
    {
      lock: true,
      force,
      onError: (error) => {
        logger.error(`[StatsCache] Failed to fetch recent records: ${getErrorMessage(error)} (code: ${getErrorCode(error)})`);
        return [];
      },
    }
  );
}

/** Both getters lock and fall back on their own, so this is just the pairing. */
export async function getStatsFromCache(): Promise<DashboardStats & { recentRecords: RecentRecords[] }> {
  const [stats, recentRecords] = await Promise.all([
    getDashboardStatsFromCache(),
    getRecentRecordsFromCache(),
  ]);

  return { ...stats, recentRecords };
}

const getLatestCompletionsInternal = async (): Promise<
  Array<{
    steamid: string;
    name: string;
    runtime: number;
    map: string;
    date: string;
    type: string;
    bonus: number | null;
  }>
> => {
  const startTime = Date.now();

  // Throws: the fallback belongs in the caller's `onError`, which isn't cached.
  const [mapRows, bonusRows] = await Promise.all([
    pool.query<RowDataPacket[]>(`
      SELECT
        pt.steamid,
        pt.name,
        pt.mapname,
        pt.runtimepro as runtime,
        pt.date,
        'map' as type,
        NULL as bonus
      FROM ck_playertimes pt
      ORDER BY pt.date DESC
      LIMIT 25
    `),
    pool.query<RowDataPacket[]>(`
      SELECT
        b.steamid,
        b.name,
        b.mapname,
        b.runtime,
        b.date,
        'bonus' as type,
        b.zonegroup as bonus
      FROM ck_bonus b
      ORDER BY b.date DESC
      LIMIT 25
    `),
  ]);

  const combined = [...mapRows[0], ...bonusRows[0]];
  combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const result = combined.slice(0, 10).map((row) => ({
    steamid: row.steamid,
    name: row.name,
    map: row.mapname,
    runtime: row.runtime,
    date: row.date,
    type: row.type,
    bonus: row.bonus,
  }));

  const duration = Date.now() - startTime;
  logger.debug(`[CompletionsCache] Fetched ${result.length} completions in ${duration}ms`);

  return result;
};

const LATEST_COMPLETIONS_KEY = 'surfstats:dashboard:completions';
const LATEST_COMPLETIONS_TTL = 180; // 3x the 60s dashboard refresh

export async function getLatestCompletionsFromCache({ force }: RefreshOptions = {}): Promise<
  Array<{
    steamid: string;
    name: string;
    runtime: number;
    map: string;
    date: string;
    type: string;
    bonus: number | null;
  }>
> {
  return cachedFetch(LATEST_COMPLETIONS_KEY, LATEST_COMPLETIONS_TTL, getLatestCompletionsInternal, {
    lock: true,
    force,
    onError: (error) => {
      logger.error(`[CompletionsCache] Failed to fetch completions: ${getErrorMessage(error)} (code: ${getErrorCode(error)})`);
      return [];
    },
  });
}
