import 'server-only';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { GameDig } from 'gamedig';
import logger from '@/lib/logger';
import { getAllMapMetadata, getTotals as getMapTotals } from './map-cache';
import { getAllBonusGroups, getAllStages } from './registry-cache';

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

// ============================================================
// IN-MEMORY SERVER CACHE WITH BACKGROUND REFRESH
// ============================================================
// This cache is refreshed every 30 seconds in the background,
// independent of user requests. Users always get instantly served
// data that's at most 30 seconds old.
//
// IMPORTANT: We use globalThis to persist the cache across Next.js
// hot reloads and serverless function invocations. Without this,
// module-level variables would be reset on each page render.

const SERVER_REFRESH_INTERVAL = 30 * 1000; // 30 seconds in milliseconds

// Define the shape of our global cache
interface GlobalServerCache {
  data: ServerStatus[];
  lastUpdated: number;
  intervalId: NodeJS.Timeout | null;
  initialized: boolean;
  initialFetchPromise: Promise<void> | null;
}

// Get or create the global cache
function getGlobalServerCache(): GlobalServerCache {
  const global = globalThis as unknown as { serverCache?: GlobalServerCache };
  if (!global.serverCache) {
    global.serverCache = {
      data: [],
      lastUpdated: 0,
      intervalId: null,
      initialized: false,
      initialFetchPromise: null,
    };
  }
  return global.serverCache;
}

// Fetch servers from live game servers
async function fetchServersFromGame(): Promise<ServerStatus[]> {
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
      const err = parseError as { message?: string };
      logger.error('[ServerCache] Failed to parse SERVERS_JSON environment variable');
      logger.error(`[ServerCache] JSON parse error: ${err.message || 'Unknown error'}`);
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
          const _duration = Date.now() - serverStart;
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
    const err = error as { message?: string };
    logger.error(`[ServerCache] Failed to fetch server statuses after ${duration}ms`);
    logger.error(`[ServerCache] Error: ${err.message || 'Unknown error'}`);
    return [];
  }
}

export { fetchServersFromGame };

// Initialize background refresh
function initServerCache(): void {
  const cache = getGlobalServerCache();

  if (cache.initialized) {
    return;
  }

  cache.initialized = true;

  // Initial fetch
  cache.initialFetchPromise = (async () => {
    try {
      const servers = await fetchServersFromGame();
      cache.data = servers;
      cache.lastUpdated = Date.now();
      logger.info(`[ServerCache] Initial fetch complete (${servers.length} servers)`);
    } catch (error: unknown) {
      const err = error as { message?: string };
      logger.error(`[ServerCache] Initial fetch failed: ${err.message}`);
    }
  })();

  // Start background refresh interval
  cache.intervalId = setInterval(() => {
    fetchServersFromGame()
      .then((servers) => {
        cache.data = servers;
        cache.lastUpdated = Date.now();
        logger.debug(`[ServerCache] Background refresh complete (${servers.length} servers)`);
      })
      .catch((err) => {
        logger.error(`[ServerCache] Background refresh error: ${err.message}`);
      });
  }, SERVER_REFRESH_INTERVAL);

  logger.info(`[ServerCache] Background refresh scheduled every ${SERVER_REFRESH_INTERVAL / 1000} seconds`);
}

/**
 * Get server status from cache
 * Returns cached data immediately - background refresh handles updates
 */
export async function getServersCached(): Promise<ServerStatus[]> {
  // Initialize cache on first call (runs on server)
  if (typeof window === 'undefined') {
    initServerCache();
  }

  const cache = getGlobalServerCache();

  // Wait for initial fetch to complete before returning
  if (cache.initialFetchPromise) {
    await cache.initialFetchPromise;
  }

  // Always return cached data - background refresh handles updates
  // This prevents blocking user requests on slow queries
  return cache.data;
}

// ============================================================
// DASHBOARD STATS CACHE (cache wrapper)
// ============================================================

const getStatsInternal = async (): Promise<{
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
}> => {
  const startTime = Date.now();

  try {
    const [statsRows] = await pool.query<RowDataPacket[]>('SELECT `key`, `value` FROM ck_stats');
    const statsMap = new Map<string, string>();
    statsRows.forEach((row) => {
      statsMap.set(row.key, row.value);
    });

    const [recentRecords] = await pool.query<RowDataPacket[]>(`
      SELECT lr.steamid, lr.name, lr.runtime, lr.map, lr.date, pr.country
      FROM ck_latestrecords lr
      LEFT JOIN ck_playerrank pr ON lr.steamid = pr.steamid
      ORDER BY lr.date DESC
      LIMIT 5
    `);

    const playerCount = parseInt(statsMap.get('player_count') || '0', 10);
    const playersMonth = parseInt(statsMap.get('players_month') || '0', 10);
    const mapCompletions = parseInt(statsMap.get('map_completions') || '0', 10);
    const bonusCompletions = parseInt(statsMap.get('bonus_completions') || '0', 10);
    const stageCompletions = parseInt(statsMap.get('stage_completions') || '0', 10);
    const totalPoints = parseInt(statsMap.get('total_points') || '0', 10);

    const duration = Date.now() - startTime;
    logger.debug(`[StatsCache] Fetched stats in ${duration}ms`);

    return {
      playerCount,
      playersMonth,
      mapCompletions,
      bonusCompletions,
      stageCompletions,
      totalPoints,
      recentRecords: recentRecords as Array<{
        steamid: string;
        name: string;
        runtime: number;
        map: string;
        date: string;
        country: string | null;
      }>,
    };
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error(`[StatsCache] Failed to fetch stats: ${err.message}`);
    return {
      playerCount: 0,
      playersMonth: 0,
      mapCompletions: 0,
      bonusCompletions: 0,
      stageCompletions: 0,
      totalPoints: 0,
      recentRecords: [],
    };
  }
};

import { cacheGet, cacheSet } from './valkey-cache';

const DASHBOARD_STATS_KEY = 'surfstats:dashboard:stats';
const DASHBOARD_STATS_TTL = 300; // 5 minutes

/**
 * Get dashboard stats from Valkey cache
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
  const cached = await cacheGet<{
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
  }>(DASHBOARD_STATS_KEY);

  if (cached) {
    return cached;
  }

  const stats = await getStatsInternal();

  await cacheSet(DASHBOARD_STATS_KEY, stats, DASHBOARD_STATS_TTL);

  return stats;
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
    const err = error as { message?: string };
    logger.error(`[CompletionsCache] Failed to fetch completions: ${err.message}`);
    return [];
  }
};

const LATEST_COMPLETIONS_KEY = 'surfstats:dashboard:completions';
const LATEST_COMPLETIONS_TTL = 300; // 5 minutes

/**
 * Get latest completions from Valkey cache
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
  const cached = await cacheGet<Array<{
    steamid: string;
    name: string;
    runtime: number;
    map: string;
    date: string;
    type: string;
    bonus: number | null;
  }>>(LATEST_COMPLETIONS_KEY);

  if (cached) {
    return cached;
  }

  const completions = await getLatestCompletionsInternal();

  await cacheSet(LATEST_COMPLETIONS_KEY, completions, LATEST_COMPLETIONS_TTL);

  return completions;
}

// =============
// TOTALS CACHE
// =============

const fetchTotalsInternal = async () => {
  const startTime = Date.now();

  try {
    const totals = await getMapTotals();
    const duration = Date.now() - startTime;
    logger.debug(`[TotalsCache] Fetched totals in ${duration}ms`);
    return totals;
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error(`[TotalsCache] Failed to fetch totals: ${err.message}`);
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
  const cached = await cacheGet<{
    totalMaps: number;
    totalBonuses: number;
    totalStages: number;
  }>(TOTALS_KEY);

  if (cached) {
    return cached;
  }

  const totals = await fetchTotalsInternal();

  await cacheSet(TOTALS_KEY, totals, TOTALS_TTL);

  return totals;
}

// ============================================================
// CACHE PREWARMING
// ============================================================
// This function is called from the root layout to pre-warm caches
// on first request. This may be reworked with Valkey implementation.

export async function prewarmCaches(): Promise<void> {
  logger.info('[Cache] Pre-warming caches...');

  // Pre-warm stats - use direct database query instead of cache
  // This still triggers the global cache initialization for subsequent requests
  try {
    const startTime = Date.now();
    const [rows] = await pool.query<RowDataPacket[]>('SELECT `key`, `value` FROM ck_stats');
    const [recentRecords] = await pool.query<RowDataPacket[]>(`
      SELECT lr.steamid, lr.name, lr.runtime, lr.map, lr.date, pr.country
      FROM ck_latestrecords lr
      LEFT JOIN ck_playerrank pr ON lr.steamid = pr.steamid
      ORDER BY lr.date DESC
      LIMIT 5
    `);
    const duration = Date.now() - startTime;
    logger.info(
      `[Cache] Stats pre-warmed successfully (${rows.length} stats, ${recentRecords.length} records, ${duration}ms)`
    );
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error('[Cache] Stats cache pre-warm failed');
    logger.error(`[Cache] Error: ${err.message || 'Unknown error'}`);
  }

  // Pre-warm totals - use direct getMapTotals call instead of cache
  // This triggers the global map cache initialization
  try {
    const startTime = Date.now();
    const totals = await getMapTotals();
    const duration = Date.now() - startTime;
    logger.info(
      `[Cache] Totals pre-warmed successfully (maps=${totals.totalMaps}, bonuses=${totals.totalBonuses}, stages=${totals.totalStages}, ${duration}ms)`
    );
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error('[Cache] Totals cache pre-warm failed');
    logger.error(`[Cache] Error: ${err.message || 'Unknown error'}`);
  }

  // Pre-warm servers cache
  try {
    const startTime = Date.now();
    await getServersCached();
    logger.info(`[Cache] Servers cache pre-warmed successfully (${Date.now() - startTime}ms)`);
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error('[Cache] Servers cache pre-warm failed');
    logger.error(`[Cache] Error: ${err.message || 'Unknown error'}`);
  }

  // Pre-warm map metadata cache (1-hour TTL)
  try {
    const startTime = Date.now();
    await getAllMapMetadata();
    logger.info(`[Cache] Map metadata cache pre-warmed successfully (${Date.now() - startTime}ms)`);
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error('[Cache] Map metadata cache pre-warm failed');
    logger.error(`[Cache] Error: ${err.message || 'Unknown error'}`);
  }

  // Pre-warm bonus/stage registry cache (1-hour TTL)
  try {
    const startTime = Date.now();
    await Promise.all([getAllBonusGroups(), getAllStages()]);
    logger.info(`[Cache] Registry cache pre-warmed successfully (${Date.now() - startTime}ms)`);
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error('[Cache] Registry cache pre-warm failed');
    logger.error(`[Cache] Error: ${err.message || 'Unknown error'}`);
  }
}
