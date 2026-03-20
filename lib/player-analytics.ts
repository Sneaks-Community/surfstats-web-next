import 'server-only';
import analyticsPool, { isAnalyticsAvailable } from '@/lib/db-analytics';
import { RowDataPacket } from 'mysql2';
import { unstable_cache } from 'next/cache';
import { convertSteamId2ToSteamId3Numeric } from '@/lib/steam';
import logger from '@/lib/logger';

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
  if (!isAnalyticsAvailable()) {
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