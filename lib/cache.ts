import 'server-only';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { GameDig } from 'gamedig';
import logger from '@/lib/logger';
import { cacheGet, cacheSet } from './valkey-cache';
import { cacheLock } from './cache-lock';
import { cachedFetch } from './cached-fetch';
import { getErrorMessage } from './errors';

// Types
interface ServerConfig {
  name: string;
  ip: string;
  port: number;
}

interface GameDigPlayer {
  name: string;
  raw?: Record<string, unknown>;
  time?: number;
  score?: number;
}

export interface Player {
  name: string;
  time?: number;
  score?: number;
}

export interface ServerStatus {
  config: ServerConfig;
  online: boolean;
  name?: string;
  map?: string;
  players?: number;
  maxplayers?: number;
  ping?: number;
  playerList?: Player[];
}

// Fetch servers from live game servers
export async function fetchServersFromGame(): Promise<ServerStatus[]> {
  const startTime = Date.now();

  try {
    logger.debug('[ServerCache] Fetching server statuses...');
    let serversJson = process.env.SERVERS_JSON || '[]';

    // Remove surrounding single quotes if they exist
    if (serversJson.startsWith("'") && serversJson.endsWith("'")) {
      serversJson = serversJson.slice(1, -1);
    }

    let configs: ServerConfig[];
    try {
      configs = JSON.parse(serversJson);
    } catch (parseError: unknown) {
      logger.error('[ServerCache] Failed to parse SERVERS_JSON environment variable');
      logger.error(`[ServerCache] JSON parse error: ${getErrorMessage(parseError)}`);
      return [];
    }

    if (!Array.isArray(configs)) {
      logger.error('[ServerCache] SERVERS_JSON is not an array');
      return [];
    }

    logger.debug(`[ServerCache] Querying ${configs.length} servers...`);

    const statuses = await Promise.all(
      configs.map(async (config) => {
        const serverStart = Date.now();
        try {
          const state = await GameDig.query({
            type: 'csgo',
            host: config.ip,
            port: config.port,
            maxAttempts: 1,
            socketTimeout: 2000,
          });

          const duration = Date.now() - serverStart;
          logger.debug(`[ServerCache] Server ${config.name} responded in ${duration}ms`);

          return {
            config,
            online: true,
            name: state.name,
            map: state.map,
            players: state.players.length,
            maxplayers: state.maxplayers,
            ping: state.ping,
            playerList: state.players.map((p: GameDigPlayer) => ({
              name: p.name || '',
              time:
                typeof p.time === 'number'
                  ? p.time
                  : typeof p.raw?.time === 'number'
                  ? p.raw.time
                  : 0,
              score: p.score || 0,
            })),
          };
        } catch (error: unknown) {
          const err = error as { code?: string };
          const errorCode = err.code || 'UNKNOWN';
          logger.debug(`[ServerCache] Server ${config.name} offline: ${errorCode}`);
          return {
            config,
            online: false,
          };
        }
      })
    );

    const onlineCount = statuses.filter((s) => s.online).length;
    const duration = Date.now() - startTime;
    logger.debug(
      `[ServerCache] Fetched ${statuses.length} servers (${onlineCount} online) in ${duration}ms`
    );

    return statuses;
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    logger.error(`[ServerCache] Failed to fetch server statuses after ${duration}ms`);
    logger.error(`[ServerCache] Error: ${getErrorMessage(error)}`);
    return [];
  }
}

// ============================================================
// DASHBOARD STATS CACHE (cache wrapper)
// ============================================================

// Split stats into separate cache entries for better granularity
const DASHBOARD_STATS_KEY = 'surfstats:dashboard:stats';
const DASHBOARD_STATS_TTL = 300; // 5 minutes for static stats

const DASHBOARD_RECENT_RECORDS_KEY = 'surfstats:dashboard:recent-records';
const DASHBOARD_RECENT_RECORDS_TTL = 60; // 1 minute for volatile recent records

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

// Split per key so a single expired key (their TTLs differ) refreshes only its
// own query instead of both.
const getDashboardStatsInternal = async (): Promise<DashboardStats> => {
  try {
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
  } catch (error: unknown) {
    logger.error(`[StatsCache] Failed to fetch stats: ${getErrorMessage(error)}`);
    return {
      playerCount: 0,
      playersMonth: 0,
      mapCompletions: 0,
      bonusCompletions: 0,
      stageCompletions: 0,
      totalPoints: 0,
    };
  }
};

const getRecentRecordsInternal = async (): Promise<RecentRecords[]> => {
  try {
    const [recentRecords] = await pool.query<RowDataPacket[]>(`
      SELECT lr.steamid, lr.name, lr.runtime, lr.map, lr.date, pr.country
      FROM ck_latestrecords lr
      LEFT JOIN ck_playerrank pr ON lr.steamid = pr.steamid
      ORDER BY lr.date DESC
      LIMIT 5
    `);
    return recentRecords as RecentRecords[];
  } catch (error: unknown) {
    logger.error(`[StatsCache] Failed to fetch recent records: ${getErrorMessage(error)}`);
    return [];
  }
};

/**
 * Get dashboard stats from Valkey cache with split cache entries
 *
 * Static stats (player count, completions, points) have 5-minute TTL.
 * Recent records have 1-minute TTL for fresher data.
 *
 * Uses request deduplication to prevent cache stampede.
 */
export async function getStatsFromCache(): Promise<{
  playerCount: number;
  playersMonth: number;
  mapCompletions: number;
  bonusCompletions: number;
  stageCompletions: number;
  totalPoints: number;
  recentRecords: Array<{
    steamid: string;
    name: string;
    runtime: number;
    map: string;
    date: string;
    country: string | null;
  }>;
}> {
  const [cachedStats, cachedRecords] = await Promise.all([
    cacheGet<DashboardStats>(DASHBOARD_STATS_KEY),
    cacheGet<RecentRecords[]>(DASHBOARD_RECENT_RECORDS_KEY),
  ]);

  // Both cached: nothing to fetch.
  if (cachedStats && cachedRecords) {
    return { ...cachedStats, recentRecords: cachedRecords };
  }

  // Cold load (both missing): fetch both under one lock and populate both keys
  // in a single pass, rather than letting each helper acquire its own lock.
  if (!cachedStats && !cachedRecords) {
    const { stats, recentRecords } = await cacheLock.acquire(
      DASHBOARD_STATS_KEY,
      async () => {
        // Double-check after acquiring the lock.
        const [rs, rr] = await Promise.all([
          cacheGet<DashboardStats>(DASHBOARD_STATS_KEY),
          cacheGet<RecentRecords[]>(DASHBOARD_RECENT_RECORDS_KEY),
        ]);
        if (rs && rr) {
          return { stats: rs, recentRecords: rr };
        }

        const [stats, recentRecords] = await Promise.all([
          getDashboardStatsInternal(),
          getRecentRecordsInternal(),
        ]);
        await Promise.all([
          cacheSet(DASHBOARD_STATS_KEY, stats, DASHBOARD_STATS_TTL),
          cacheSet(DASHBOARD_RECENT_RECORDS_KEY, recentRecords, DASHBOARD_RECENT_RECORDS_TTL),
        ]);
        return { stats, recentRecords };
      }
    );

    return { ...stats, recentRecords };
  }

  // Exactly one key missing (their TTLs differ): refresh only the missing one.
  const [stats, recentRecords] = await Promise.all([
    cachedStats ?? getDashboardStatsFromCache(),
    cachedRecords ?? getRecentRecordsFromCache(),
  ]);

  return { ...stats, recentRecords };
}

/**
 * Get static dashboard stats from Valkey cache
 */
export async function getDashboardStatsFromCache(): Promise<DashboardStats> {
  return cachedFetch(
    DASHBOARD_STATS_KEY,
    DASHBOARD_STATS_TTL,
    getDashboardStatsInternal,
    { lock: true }
  );
}

/**
 * Get recent records from Valkey cache with shorter TTL
 */
export async function getRecentRecordsFromCache(): Promise<RecentRecords[]> {
  return cachedFetch(
    DASHBOARD_RECENT_RECORDS_KEY,
    DASHBOARD_RECENT_RECORDS_TTL,
    getRecentRecordsInternal,
    { lock: true }
  );
}

// =========================
// LATEST COMPLETIONS CACHE
// =========================

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

  try {
    // Fetch map and bonus completions separately, then combine and sort
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

    // Combine and sort in application code
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
  } catch (error: unknown) {
    logger.error(`[CompletionsCache] Failed to fetch completions: ${getErrorMessage(error)}`);
    return [];
  }
};

const LATEST_COMPLETIONS_KEY = 'surfstats:dashboard:completions';
const LATEST_COMPLETIONS_TTL = 180; // Reduced to 3 minutes for fresher data

/**
 * Get latest completions from Valkey cache with request deduplication
 *
 * Uses CacheLock to prevent cache stampede when multiple requests miss
 * the cache simultaneously. Also implements probabilistic early expiration
 * to further reduce stampede risk.
 *
 * @returns Array of latest completions
 */
export async function getLatestCompletionsFromCache(): Promise<
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
  });
}

// =============
// TOTALS CACHE
// =============

const fetchTotalsInternal = async () => {
  const startTime = Date.now();

  try {
    const { getTotals } = await import('./map-cache');
    const totals = await getTotals();
    const duration = Date.now() - startTime;
    logger.debug(`[TotalsCache] Fetched totals in ${duration}ms`);
    return totals;
  } catch (error: unknown) {
    logger.error(`[TotalsCache] Failed to fetch totals: ${getErrorMessage(error)}`);
    return { totalMaps: 0, totalBonuses: 0, totalStages: 0 };
  }
};

const TOTALS_KEY = 'surfstats:totals:data';
const TOTALS_TTL = 300; // 5 minutes

/**
 * Get totals from Valkey cache
 */
export async function getTotalsFromCache(): Promise<{
  totalMaps: number;
  totalBonuses: number;
  totalStages: number;
}> {
  return cachedFetch(TOTALS_KEY, TOTALS_TTL, fetchTotalsInternal);
}

// ============================================================
// CACHE PREWARMING
// ============================================================
// This function is called from the root layout to pre-warm caches
// on first request.

export async function prewarmCaches(): Promise<void> {
  logger.info('[Cache] Pre-warming caches...');

  // Pre-warm stats - populates the Valkey cache
  try {
    const startTime = Date.now();
    await getStatsFromCache();
    logger.info(`[Cache] Stats cache pre-warmed successfully (${Date.now() - startTime}ms)`);
  } catch (error: unknown) {
    logger.error('[Cache] Stats cache pre-warm failed');
    logger.error(`[Cache] Error: ${getErrorMessage(error)}`);
  }

  // Pre-warm totals - populates the Valkey cache
  try {
    const startTime = Date.now();
    const totals = await getTotalsFromCache();
    const duration = Date.now() - startTime;
    logger.info(
      `[Cache] Totals cache pre-warmed successfully (maps=${totals.totalMaps}, bonuses=${totals.totalBonuses}, stages=${totals.totalStages}, ${duration}ms)`
    );
  } catch (error: unknown) {
    logger.error('[Cache] Totals cache pre-warm failed');
    logger.error(`[Cache] Error: ${getErrorMessage(error)}`);
  }

  // Pre-warm servers cache via Valkey
  try {
    const startTime = Date.now();
    const { getServersFromCache } = await import('./valkey-server-cache');
    await getServersFromCache();
    logger.info(`[Cache] Servers cache pre-warmed successfully (${Date.now() - startTime}ms)`);
  } catch (error: unknown) {
    logger.error('[Cache] Servers cache pre-warm failed');
    logger.error(`[Cache] Error: ${getErrorMessage(error)}`);
  }

  // Pre-warm map metadata cache (1-hour TTL)
  try {
    const startTime = Date.now();
    const { getAllMapMetadataFromCache } = await import('./valkey-map-cache');
    await getAllMapMetadataFromCache();
    logger.info(`[Cache] Map metadata cache pre-warmed successfully (${Date.now() - startTime}ms)`);
  } catch (error: unknown) {
    logger.error('[Cache] Map metadata cache pre-warm failed');
    logger.error(`[Cache] Error: ${getErrorMessage(error)}`);
  }

  // Pre-warm bonus/stage registry cache (1-hour TTL)
  try {
    const startTime = Date.now();
    const { getAllBonusGroupsFromCache, getAllStagesFromCache } = await import('./valkey-registry-cache');
    await Promise.all([getAllBonusGroupsFromCache(), getAllStagesFromCache()]);
    logger.info(`[Cache] Registry cache pre-warmed successfully (${Date.now() - startTime}ms)`);
  } catch (error: unknown) {
    logger.error('[Cache] Registry cache pre-warm failed');
    logger.error(`[Cache] Error: ${getErrorMessage(error)}`);
  }
}
