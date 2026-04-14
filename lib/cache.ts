import 'server-only';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import { GameDig } from 'gamedig';
import { unstable_cache } from 'next/cache';
import logger from '@/lib/logger';
import { getAllMapMetadata, getTotals as getMapTotals } from './map-cache';
import { getAllBonusGroups, getAllStages } from './registry-cache';

// Types
interface ServerConfig {
  name: string;
  ip: string;
  port: number;
}

interface Player {
  name: string;
  raw?: any;
  time?: number;
  score?: number;
}

interface ServerStatus {
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
    } catch (parseError: any) {
      logger.error('[ServerCache] Failed to parse SERVERS_JSON environment variable');
      logger.error(`[ServerCache] JSON parse error: ${parseError.message}`);
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
            playerList: state.players.map((p: any) => ({
              name: p.name || '',
              time: p.time || p.raw?.time || 0,
              score: p.score || 0
            })),
          };
        } catch (error: any) {
          const duration = Date.now() - serverStart;
          const errorCode = error.code || 'UNKNOWN';
          logger.debug(`[ServerCache] Server ${config.name} offline: ${errorCode}`);
          return {
            config,
            online: false,
          };
        }
      })
    );
    
    const onlineCount = statuses.filter(s => s.online).length;
    const duration = Date.now() - startTime;
    logger.debug(`[ServerCache] Fetch complete: ${onlineCount}/${statuses.length} online (${duration}ms)`);
    
    return statuses;
  } catch (error: any) {
    logger.error(`[ServerCache] Unexpected error: ${error.message}`);
    return [];
  }
}

// Refresh the server cache
async function refreshServerCache(): Promise<void> {
  const cache = getGlobalServerCache();
  const startTime = Date.now();
  
  try {
    logger.debug('[ServerCache] Background refresh starting...');
    cache.data = await fetchServersFromGame();
    cache.lastUpdated = Date.now();
    
    const duration = Date.now() - startTime;
    const age = Math.round((Date.now() - cache.lastUpdated) / 1000);
    logger.debug(`[ServerCache] Background refresh complete (age: ${age}s, duration: ${duration}ms)`);
  } catch (error: any) {
    logger.error(`[ServerCache] Background refresh failed: ${error.message}`);
  }
}

// Initialize the background refresh mechanism
function initServerCache(): void {
  if (typeof window !== 'undefined') {
    // Skip in browser context
    return;
  }
  
  const cache = getGlobalServerCache();
  
  if (cache.initialized) {
    return;
  }
  
  cache.initialized = true;
  logger.info('[ServerCache] Initializing background server cache (30s interval)...');
  
  // Initial fetch - store promise so callers can await it
  cache.initialFetchPromise = refreshServerCache().catch(err => {
    logger.error(`[ServerCache] Initial refresh failed: ${err.message}`);
  });
  
  // Set up interval for background refresh
  cache.intervalId = setInterval(() => {
    refreshServerCache().catch(err => {
      logger.error(`[ServerCache] Interval refresh failed: ${err.message}`);
    });
  }, SERVER_REFRESH_INTERVAL);
  
  logger.info('[ServerCache] Background refresh interval started');
}

// Public function to get servers from in-memory cache
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
  
  // Return cached data
  return cache.data;
}

// Get cache metadata for debugging/monitoring
export function getServerCacheStats(): { lastUpdated: number; ageSeconds: number; initialized: boolean } {
  const cache = getGlobalServerCache();
  return {
    lastUpdated: cache.lastUpdated,
    ageSeconds: cache.lastUpdated ? Math.round((Date.now() - cache.lastUpdated) / 1000) : -1,
    initialized: cache.initialized,
  };
}

// ============================================================
// UNSTABLE_CACHE: Used for stats and totals (database queries)
// These don't need background refresh as database queries are fast
// ============================================================

// Fetch stats from database - throws on error so cache doesn't store bad data
// Note: This is a sync function returning a Promise (not async) for unstable_cache compatibility
function fetchStatsInternal() {
  const startTime = Date.now();
  
  // PARALLEL: Fetch stats and recent records simultaneously
  return Promise.all([
    pool.query<RowDataPacket[]>('SELECT `key`, `value` FROM ck_stats'),
    pool.query<RowDataPacket[]>(`
      SELECT lr.steamid, lr.name, lr.runtime, lr.map, lr.date, pr.country
      FROM ck_latestrecords lr
      LEFT JOIN ck_playerrank pr ON lr.steamid = pr.steamid
      ORDER BY lr.date DESC
      LIMIT 5
    `)
  ])
    .then(([statsResult, recordsResult]) => {
      const [statsRows] = statsResult;
      const [recentRecords] = recordsResult;
      
      // If database returned empty (connection failed), throw to prevent caching
      if (!statsRows || statsRows.length === 0) {
        const error = new Error('Database returned empty stats');
        logger.error('[Cache] Stats query returned empty result - database may be unavailable');
        throw error;
      }
      
      const statsMap = statsRows.reduce((acc, row) => {
        acc[row.key] = row.value;
        return acc;
      }, {} as Record<string, number>);
      
      const duration = Date.now() - startTime;
      logger.debug(`[Cache] Stats fetched successfully in ${duration}ms (${statsRows.length} stats, ${recentRecords.length} records)`);
      
      return {
        playerCount: statsMap['player_count'] || 0,
        mapCompletions: statsMap['map_completions'] || 0,
        bonusCompletions: statsMap['bonus_completions'] || 0,
        stageCompletions: statsMap['stage_completions'] || 0,
        totalPoints: statsMap['total_points'] || 0,
        playersMonth: statsMap['players_month'] || 0,
        recentRecords,
      };
    })
    .catch((error: any) => {
      const duration = Date.now() - startTime;
      logger.error(`[Cache] Failed to fetch stats after ${duration}ms`);
      logger.error(`[Cache] Error: ${error.message || 'Unknown error'}`);
      throw error;
    });
}

// Cache stats for 5 minutes - only successful results get cached
export const getStatsCached = unstable_cache(
  fetchStatsInternal,
  ['dashboard-stats'],
  { revalidate: 300 }
);

// Fetch latest completions (map + bonus) - combined and sorted by date
// Note: This is a sync function returning a Promise (not async) for unstable_cache compatibility
function fetchLatestCompletionsInternal() {
  const startTime = Date.now();
  
  // Fetch top N from each table separately using indexes, then combine and sort in application code.
  return Promise.all([
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
    `)
  ]).then(([mapRows, bonusRows]) => {
    const duration = Date.now() - startTime;
    
    // Combine and sort in application code
    const combined = [...mapRows[0], ...bonusRows[0]];
    combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    const result = combined.slice(0, 10).map(row => ({
      steamid: row.steamid,
      name: row.name,
      map: row.mapname,
      runtime: row.runtime,
      date: row.date,
      type: row.type,
      bonus: row.bonus,
    }));
    
    // Single pass to count map and bonus completions
    const { mapCount, bonusCount } = result.reduce(
      (acc, r) => {
        if (r.type === 'map') acc.mapCount++;
        else if (r.type === 'bonus') acc.bonusCount++;
        return acc;
      },
      { mapCount: 0, bonusCount: 0 }
    );
    logger.debug(`[Cache] Latest completions fetched successfully in ${duration}ms (${result.length} records: ${mapCount} map, ${bonusCount} bonus)`);
    
    return result;
  }).catch((error: any) => {
    const duration = Date.now() - startTime;
    logger.error(`[Cache] Failed to fetch latest completions after ${duration}ms`);
    logger.error(`[Cache] Error: ${error.message || 'Unknown error'}`);
    throw error;
  });
}

// Cache latest completions for 5 minutes (300 seconds)
export const getLatestCompletionsCached = unstable_cache(
  fetchLatestCompletionsInternal,
  ['dashboard-completions'],
  { revalidate: 300 }
);

// Fetch totals (maps, bonuses, stages) - used for player progress bars
// Now uses the global map cache instead of database queries
// Note: This is a sync function returning a Promise (not async) for unstable_cache compatibility
function fetchTotalsInternal() {
  const startTime = Date.now();
  
  logger.debug('[Cache] Fetching totals from global map cache...');
  
  // Use the global map cache instead of database queries
  return getMapTotals().then(totals => {
    const duration = Date.now() - startTime;
    logger.debug(`[Cache] Totals fetched successfully in ${duration}ms: maps=${totals.totalMaps}, bonuses=${totals.totalBonuses}, stages=${totals.totalStages}`);
    
    return totals;
  }).catch((error: any) => {
    const duration = Date.now() - startTime;
    logger.error(`[Cache] Failed to fetch totals after ${duration}ms`);
    logger.error(`[Cache] Error: ${error.message || 'Unknown error'}`);
    throw error;
  });
}

// Cache totals for 5 minutes (300 seconds)
// Note: The underlying map cache has a 1-hour TTL, so this provides an additional layer
export const getTotalsCached = unstable_cache(
  fetchTotalsInternal,
  ['totals-data'],
  { revalidate: 300 }
);

// Pre-warm all caches on startup
// Note: We use direct database calls instead of unstable_cache wrappers because
// unstable_cache requires a React Server Component context which isn't available
// during module initialization. The direct calls still trigger cache initialization
// for the global in-memory caches (map-cache, player-cache, registry-cache).
export async function prewarmCaches() {
  logger.info('[Cache] Pre-warming caches...');
  
  // Pre-warm stats - use direct database query instead of unstable_cache
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
    logger.info(`[Cache] Stats pre-warmed successfully (${rows.length} stats, ${recentRecords.length} records, ${duration}ms)`);
  } catch (error: any) {
    logger.error('[Cache] Stats cache pre-warm failed');
    logger.error(`[Cache] Error: ${error.message || 'Unknown error'}`);
  }
  
  // Pre-warm totals - use direct getMapTotals call instead of unstable_cache
  // This triggers the global map cache initialization
  try {
    const startTime = Date.now();
    const totals = await getMapTotals();
    const duration = Date.now() - startTime;
    logger.info(`[Cache] Totals pre-warmed successfully (maps=${totals.totalMaps}, bonuses=${totals.totalBonuses}, stages=${totals.totalStages}, ${duration}ms)`);
  } catch (error: any) {
    logger.error('[Cache] Totals cache pre-warm failed');
    logger.error(`[Cache] Error: ${error.message || 'Unknown error'}`);
  }
  
  // Pre-warm servers cache
  try {
    const startTime = Date.now();
    await getServersCached();
    logger.info(`[Cache] Servers cache pre-warmed successfully (${Date.now() - startTime}ms)`);
  } catch (error: any) {
    logger.error('[Cache] Servers cache pre-warm failed');
    logger.error(`[Cache] Error: ${error.message || 'Unknown error'}`);
  }
  
  // Pre-warm map metadata cache (1-hour TTL)
  try {
    const startTime = Date.now();
    await getAllMapMetadata();
    logger.info(`[Cache] Map metadata cache pre-warmed successfully (${Date.now() - startTime}ms)`);
  } catch (error: any) {
    logger.error('[Cache] Map metadata cache pre-warm failed');
    logger.error(`[Cache] Error: ${error.message || 'Unknown error'}`);
  }
  
  // Pre-warm bonus/stage registry cache (1-hour TTL)
  try {
    const startTime = Date.now();
    await Promise.all([getAllBonusGroups(), getAllStages()]);
    logger.info(`[Cache] Registry cache pre-warmed successfully (${Date.now() - startTime}ms)`);
  } catch (error: any) {
    logger.error('[Cache] Registry cache pre-warm failed');
    logger.error(`[Cache] Error: ${error.message || 'Unknown error'}`);
  }
}