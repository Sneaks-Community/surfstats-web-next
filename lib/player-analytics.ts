import 'server-only';
import analyticsPool from '@/lib/db-analytics';
import type { RowDataPacket } from 'mysql2';
import { convertSteamId2ToSteamId3Numeric } from '@/lib/steam';
import logger from '@/lib/logger';
import { cachedFetch } from './cached-fetch';
import { getErrorMessage } from './errors';

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
    const errorMessage = getErrorMessage(error);
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

  // A null result (analytics unavailable / invalid id / error) is not cached.
  return cachedFetch(cacheKey, PLAYER_TIME_TTL, () => getPlayerTimeOnServerInternal(steamId));
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
    const errorMessage = getErrorMessage(error);
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

  // A null result (analytics unavailable / invalid id / error) is not cached.
  return cachedFetch(cacheKey, ACTIVITY_HEATMAP_TTL, () => getPlayerActivityHeatmapInternal(steamId));
}
