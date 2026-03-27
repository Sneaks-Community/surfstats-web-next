import 'server-only';
import analyticsPool, { isAnalyticsAvailable } from '@/lib/db-analytics';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import { unstable_cache } from 'next/cache';
import { convertSteamId2ToSteamId3Numeric } from '@/lib/steam';
import logger from '@/lib/logger';

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
        total_duration as total_duration,
        connection_count as connection_count
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
  } catch (error: any) {
    // Log error but don't throw - analytics is optional
    const errorMessage = error.message || 'Unknown error';
    logger.error(`[Analytics] Failed to fetch time data for ${steamId}: ${errorMessage}`);
    return null;
  }
}

/**
 * Cached version of getPlayerTimeOnServer for use in server components
 * Cache for 5 minutes (300 seconds) to reduce database load on high-traffic pages
 */
export const getPlayerTimeOnServer = unstable_cache(
  getPlayerTimeOnServerInternal,
  ['player-time-on-server'],
  { revalidate: 300 }
);

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
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error';
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
      } else if (row.date && typeof (row.date as any).toISOString === 'function') {
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
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error';
    logger.error(`[Analytics] Failed to fetch performance trend for ${steamId}: ${errorMessage}`);
    return null;
  }
}

/**
 * Cached version of getPerformanceTrend for use in server components
 * Cache for 5 minutes (300 seconds) to reduce database load on high-traffic pages
 */
export const getPerformanceTrend = unstable_cache(
  getPerformanceTrendInternal,
  ['player-performance-trend'],
  { revalidate: 300 }
);
