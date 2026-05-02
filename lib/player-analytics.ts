import 'server-only';
import analyticsPool, { isAnalyticsAvailable } from '@/lib/db-analytics';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { convertSteamId2ToSteamId3Numeric } from '@/lib/steam';
import logger from '@/lib/logger';
import { cacheGet, cacheSet } from './valkey-cache';

// Check if analytics database is configured (env vars are set)
const isAnalyticsConfigured = !!(
  process.env.ANALYTICS_MYSQL_HOST ||
  process.env.ANALYTICS_MYSQL_DATABASE ||
  (process.env.MYSQL_HOST && process.env.MYSQL_DATABASE)
);

interface PlayerTimeData extends RowDataPacket {
  total_duration: number | null;
  connection_count: number;
}

interface PlayerTimeResult {
  totalSeconds: number;
  connectionCount: number;
}

/**
 * Fetch total playtime for a player from the analytics database
 * @param steamId - SteamID2 format (e.g., STEAM_1:0:95515509)
 * @returns Object with totalSeconds and connectionCount, or null if unavailable
 */
async function getPlayerTimeOnServerInternal(steamId: string): Promise<PlayerTimeResult | null> {
  // Return null if analytics is not configured - box will be hidden
  if (!isAnalyticsConfigured) {
    return null;
  }

  const steamId3Numeric = convertSteamId2ToSteamId3Numeric(steamId);
  if (steamId3Numeric === null) {
    logger.warn(`[Analytics] Invalid SteamID format: ${steamId}`);
    return null;
  }

  try {
    // Use the pre-aggregated summary table for fast lookups
    // Falls back to original query if summary table doesn't exist
    const [rows] = await analyticsPool.query<PlayerTimeData[]>(`
      SELECT
        total_duration,
        connection_count
      FROM player_analytics_summary
      WHERE steamid3 = ?
    `, [steamId3Numeric]);

    if (rows.length === 0) {
      // No data found in summary - player has no connections
      return { totalSeconds: 0, connectionCount: 0 };
    }

    const row = rows[0];
    return {
      totalSeconds: row.total_duration || 0,
      connectionCount: row.connection_count || 0,
    };
  } catch (error: unknown) {
    // Log error but don't throw - analytics is optional
    const err = error as { message?: string };
    const errorMessage = err.message || 'Unknown error';
    logger.error(`[Analytics] Failed to fetch time data for ${steamId}: ${errorMessage}`);
    return null;
  }
}

const PLAYER_TIME_KEY = 'surfstats:player:time';
const PLAYER_TIME_TTL = 300; // 5 minutes

/**
 * Get player time on server from Valkey cache
 * Cache for 5 minutes (300 seconds) to reduce database load on high-traffic pages
 */
export async function getPlayerTimeOnServerFromCache(
  steamId: string
): Promise<PlayerTimeResult | null> {
  const cacheKey = `${PLAYER_TIME_KEY}:${steamId}`;
  
  const cached = await cacheGet<PlayerTimeResult>(cacheKey);

  if (cached) {
    return cached;
  }

  const result = await getPlayerTimeOnServerInternal(steamId);

  if (result) {
    await cacheSet(cacheKey, result, PLAYER_TIME_TTL);
  }

  return result;
}

/**
 * Get total playtime for multiple players in a single query
 * More efficient than individual queries when loading player lists
 * @param steamIds - Array of SteamID2 format strings
 * @returns Map of SteamID to PlayerTimeResult
 */
export async function getPlayersTimeOnServer(steamIds: string[]): Promise<Map<string, PlayerTimeResult>> {
  const result = new Map<string, PlayerTimeResult>();

  // Return empty results if analytics is not configured
  if (!isAnalyticsAvailable()) {
    for (const steamId of steamIds) {
      result.set(steamId, { totalSeconds: 0, connectionCount: 0 });
    }
    return result;
  }

  if (steamIds.length === 0) {
    return result;
  }

  // Convert all SteamIDs to SteamID3 numeric and map them back
  const steamId3Map = new Map<number, string>();
  const steamId3s: number[] = [];

  for (const steamId of steamIds) {
    const steamId3Numeric = convertSteamId2ToSteamId3Numeric(steamId);
    if (steamId3Numeric !== null) {
      steamId3Map.set(steamId3Numeric, steamId);
      steamId3s.push(steamId3Numeric);
    }
  }

  if (steamId3s.length === 0) {
    return result;
  }

  try {
    // Use the pre-aggregated summary table for fast lookups
    const placeholders = steamId3s.map(() => '?').join(',');
    const [rows] = await analyticsPool.query<PlayerTimeData[]>(`
      SELECT
        steamid3,
        total_duration,
        connection_count
      FROM player_analytics_summary
      WHERE steamid3 IN (${placeholders})
    `, steamId3s);

    // Map results back to original SteamIDs
    for (const row of rows) {
      const originalSteamId = steamId3Map.get(row.steamid3);
      if (originalSteamId) {
        result.set(originalSteamId, {
          totalSeconds: row.total_duration || 0,
          connectionCount: row.connection_count || 0,
        });
      }
    }

    // Set default values for SteamIDs with no data
    for (const steamId of steamIds) {
      if (!result.has(steamId)) {
        result.set(steamId, { totalSeconds: 0, connectionCount: 0 });
      }
    }
  } catch (error: unknown) {
    const err = error as { message?: string };
    const errorMessage = err.message || 'Unknown error';
    logger.error(`[Analytics] Failed to fetch batch time data: ${errorMessage}`);
    
    // Return empty results for all SteamIDs on error
    for (const steamId of steamIds) {
      result.set(steamId, { totalSeconds: 0, connectionCount: 0 });
    }
  }

  return result;
}

// Performance Trend Data Interface
interface PerformanceTrendData extends RowDataPacket {
  mapname: string;
  runtimepro: number;
  date: string;
  tier: number;
}

interface PerformanceTrendResult {
  date: string;
  avgTime: number;
  mapCount: number;
  tier: number;
}

/**
 * Fetch performance trend data for a player
 * Returns completion times grouped by date and tier for visualization
 * @param steamId - SteamID2 format (e.g., STEAM_1:0:95515509)
 * @returns Array of performance data points, or null if unavailable
 */
async function getPerformanceTrendInternal(steamId: string): Promise<PerformanceTrendResult[] | null> {
  try {
    logger.debug(`[Analytics] Fetching performance trend for ${steamId}`);
    
    const [rows] = await pool.query<PerformanceTrendData[]>(`
      SELECT
        pt.mapname,
        pt.runtimepro,
        pt.date,
        COALESCE(mt.tier, 1) as tier
      FROM ck_playertimes pt
      LEFT JOIN ck_maptier mt ON pt.mapname = mt.mapname
      WHERE pt.steamid = ?
      ORDER BY pt.date DESC
    `, [steamId]);

    logger.debug(`[Analytics] Found ${rows.length} records for ${steamId}`);

    if (rows.length === 0) {
      logger.debug(`[Analytics] No records found for ${steamId}`);
      return [];
    }

    // Aggregate by date and tier
    const aggregated = new Map<string, Map<number, { total: number; count: number }>>();

    for (const row of rows) {
      // Handle both string and Date objects from MySQL
      let dateStr: string;
      if (typeof row.date === 'string') {
        dateStr = row.date.split('T')[0]; // Extract date part only
      } else if (row.date && typeof (row.date as Date).toISOString === 'function') {
        dateStr = (row.date as Date).toISOString().split('T')[0];
      } else {
        continue; // Skip invalid date values
      }
      const tier = row.tier;
      
      if (!aggregated.has(dateStr)) {
        aggregated.set(dateStr, new Map());
      }
      
      const tierData = aggregated.get(dateStr)!;
      const current = tierData.get(tier) || { total: 0, count: 0 };
      current.total += row.runtimepro;
      current.count += 1;
      tierData.set(tier, current);
    }

    // Convert to result format
    const result: PerformanceTrendResult[] = [];
    for (const [date, tiers] of aggregated) {
      for (const [tier, { total, count }] of tiers) {
        if (count > 0) {
          result.push({
            date,
            avgTime: total / count,
            mapCount: count,
            tier,
          });
        }
      }
    }

    // Sort by date ascending
    result.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return result;
  } catch (error: unknown) {
    const err = error as { message?: string };
    const errorMessage = err.message || 'Unknown error';
    logger.error(`[Analytics] Failed to fetch performance trend for ${steamId}: ${errorMessage}`);
    return null;
  }
}

/**
 * Cache key and TTL for performance trend data
 */
const PERFORMANCE_TREND_KEY = 'surfstats:player:performance-trend';
const PERFORMANCE_TREND_TTL = 300; // 5 minutes

/**
 * Cached version of getPerformanceTrend for use in server components
 * Cache for 5 minutes (300 seconds) to reduce database load on high-traffic pages
 */
export async function getPerformanceTrendFromCache(
  steamId: string
): Promise<PerformanceTrendResult[] | null> {
  const cacheKey = `${PERFORMANCE_TREND_KEY}:${steamId}`;
  
  const cached = await cacheGet<PerformanceTrendResult[]>(cacheKey);
  
  if (cached !== null) {
    return cached;
  }
  
  const result = await getPerformanceTrendInternal(steamId);
  
  if (result !== null) {
    await cacheSet(cacheKey, result, PERFORMANCE_TREND_TTL);
  }
  
  return result;
}

// Activity Heatmap Data Interface
interface PlayerConnectData extends RowDataPacket {
  connect_time: string | Date;
}

interface HeatmapDataPoint {
  dayOfWeek: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  hour: number;      // 0-23
  count: number;
}

/**
 * Fetch player connection activity heatmap data
 * Returns a grid of day-of-week vs hour-of-day connection counts
 * @param steamId - SteamID2 format (e.g., STEAM_1:0:95515509)
 * @returns 2D array of connection counts [dayOfWeek][hour], or null if unavailable
 */
async function getPlayerActivityHeatmapInternal(
  steamId: string
): Promise<HeatmapDataPoint[] | null> {
  // Return null if analytics is not configured
  if (!isAnalyticsConfigured) {
    return null;
  }

  const steamId3Numeric = convertSteamId2ToSteamId3Numeric(steamId);
  if (steamId3Numeric === null) {
    logger.warn(`[Analytics] Invalid SteamID format: ${steamId}`);
    return null;
  }

  try {
    logger.debug(`[Analytics] Fetching activity heatmap for ${steamId} (steamid3=${steamId3Numeric})`);

    const [rows] = await analyticsPool.query<PlayerConnectData[]>(`
      SELECT
        connect_time
      FROM player_analytics
      WHERE steamid3 = ?
      ORDER BY connect_time DESC
      LIMIT 10000
    `, [steamId3Numeric]);

    logger.debug(`[Analytics] Found ${rows.length} connection records for ${steamId}`);

    if (rows.length === 0) {
      logger.debug(`[Analytics] No connection records found for ${steamId}`);
      return [];
    }

    // Aggregate by day of week and hour
    const aggregated = new Map<string, number>();

    for (const row of rows) {
      // connect_time is stored as Unix timestamp (seconds) in the database
      // MySQL returns it as a number, which needs to be multiplied by 1000 for JavaScript Date
      let date: Date;
      if (typeof row.connect_time === 'number') {
        date = new Date(row.connect_time * 1000);
      } else if (typeof row.connect_time === 'string') {
        date = new Date(row.connect_time);
      } else if (row.connect_time instanceof Date) {
        date = row.connect_time;
      } else {
        continue;
      }

      // Skip invalid dates
      if (isNaN(date.getTime())) {
        continue;
      }

      const dayOfWeek = date.getDay(); // 0=Sunday, 6=Saturday
      const hour = date.getHours();
      const key = `${dayOfWeek}-${hour}`;

      aggregated.set(key, (aggregated.get(key) || 0) + 1);
    }

    // Convert to array format
    const result: HeatmapDataPoint[] = [];
    for (const [key, count] of aggregated) {
      const [dayOfWeek, hour] = key.split('-').map(Number);
      result.push({ dayOfWeek, hour, count });
    }

    return result;
  } catch (error: unknown) {
    const err = error as { message?: string };
    const errorMessage = err.message || 'Unknown error';
    logger.error(`[Analytics] Failed to fetch activity heatmap for ${steamId}: ${errorMessage}`);
    return null;
  }
}

/**
 * Cache key and TTL for activity heatmap data
 */
const ACTIVITY_HEATMAP_KEY = 'surfstats:player:activity-heatmap';
const ACTIVITY_HEATMAP_TTL = 3600; // 1 hour (data changes slowly)

/**
 * Cached version of getPlayerActivityHeatmap for use in server components
 * Cache for 1 hour (3600 seconds) to reduce database load on high-traffic pages
 */
export async function getActivityHeatmapFromCache(
  steamId: string
): Promise<HeatmapDataPoint[] | null> {
  const cacheKey = `${ACTIVITY_HEATMAP_KEY}:${steamId}`;

  const cached = await cacheGet<HeatmapDataPoint[]>(cacheKey);

  if (cached !== null) {
    return cached;
  }

  const result = await getPlayerActivityHeatmapInternal(steamId);

  if (result !== null) {
    await cacheSet(cacheKey, result, ACTIVITY_HEATMAP_TTL);
  }

  return result;
}
