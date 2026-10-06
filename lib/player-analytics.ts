import 'server-only';
import analyticsPool, { isAnalyticsAvailable } from '@/lib/db-analytics';
import type { RowDataPacket } from 'mysql2';
import { convertSteamId2ToSteamId3Numeric } from '@/lib/steam';
import logger from '@/lib/logger';
import { cachedFetch, type RefreshOptions } from './cached-fetch';
import { getErrorMessage } from './errors';
import { getDisplayTz, HEATMAP_MAX_SESSIONS } from './utils';

interface PlayerTimeData extends RowDataPacket {
  total_duration: number | null;
  connection_count: number;
}

interface PlayerTimeResult {
  totalSeconds: number;
  connectionCount: number;
}

/** Total playtime for a SteamID2. Null when analytics is unavailable (unconfigured, or the
 * startup check failed) or the query fails, which hides the box. */
async function getPlayerTimeOnServerInternal(steamId: string): Promise<PlayerTimeResult | null> {
  if (!isAnalyticsAvailable()) {
    return null;
  }

  const steamId3Numeric = convertSteamId2ToSteamId3Numeric(steamId);
  if (steamId3Numeric === null) {
    logger.warn(`[Analytics] Invalid SteamID format: ${steamId}`);
    return null;
  }

  try {
    // The summary table is required: there is no raw-scan fallback, so a deployment
    // without it gets null playtime.
    const [rows] = await analyticsPool.query<PlayerTimeData[]>(`
      SELECT
        total_duration,
        connection_count
      FROM player_analytics_summary
      WHERE steamid3 = ?
    `, [steamId3Numeric]);

    if (rows.length === 0) {
      // No summary row: the player has never connected.
      return { totalSeconds: 0, connectionCount: 0 };
    }

    const row = rows[0];
    return {
      totalSeconds: row.total_duration || 0,
      connectionCount: row.connection_count || 0,
    };
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    logger.error(`[Analytics] Failed to fetch time data for ${steamId}: ${errorMessage}`);
    return null;
  }
}

const PLAYER_TIME_KEY = 'surfstats:player:time';
const PLAYER_TIME_TTL = 3600; // 1 hour, in step with the other profile render keys

export async function getPlayerTimeOnServerFromCache(
  steamId: string,
  { force }: RefreshOptions = {}
): Promise<PlayerTimeResult | null> {
  const cacheKey = `${PLAYER_TIME_KEY}:${steamId}`;

  // A null result (analytics unavailable / invalid id / error) is not cached.
  return cachedFetch(cacheKey, PLAYER_TIME_TTL, () => getPlayerTimeOnServerInternal(steamId), { force });
}

interface PlayerConnectData extends RowDataPacket {
  /** Unix epoch seconds (an `int` column). */
  connect_time: number;
}

interface HeatmapDataPoint {
  dayOfWeek: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  hour: number;      // 0-23
  count: number;
}

const bucketFormatter = new Map<string, Intl.DateTimeFormat>();

/** Day of week and hour of an instant in the display TZ (`Date#getDay`/`getHours` would use the
 * container's). Intl rather than offset arithmetic, which DST breaks. */
function bucketParts(date: Date, timeZone: string): { dayOfWeek: number; hour: number } | null {
  let formatter = bucketFormatter.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: 'numeric',
      hour12: false,
    });
    bucketFormatter.set(timeZone, formatter);
  }

  const parts = formatter.formatToParts(date);
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const hourValue = parts.find((p) => p.type === 'hour')?.value;
  if (!weekday || hourValue === undefined) return null;

  const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  // hour12: false yields 24 for midnight in some ICU versions.
  const hour = Number(hourValue) % 24;
  if (dayOfWeek === -1 || !Number.isInteger(hour)) return null;

  return { dayOfWeek, hour };
}

/** Sparse day-of-week x hour connection counts for a SteamID2; null if analytics is unavailable. */
async function getPlayerActivityHeatmapInternal(
  steamId: string
): Promise<HeatmapDataPoint[] | null> {
  if (!isAnalyticsAvailable()) {
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
      LIMIT ${HEATMAP_MAX_SESSIONS}
    `, [steamId3Numeric]);

    logger.debug(`[Analytics] Found ${rows.length} connection records for ${steamId}`);

    if (rows.length === 0) {
      logger.debug(`[Analytics] No connection records found for ${steamId}`);
      return [];
    }

    const timeZone = getDisplayTz();
    const aggregated = new Map<string, number>();

    for (const row of rows) {
      const date = new Date(row.connect_time * 1000);
      if (isNaN(date.getTime())) continue;

      const bucket = bucketParts(date, timeZone);
      if (!bucket) continue;

      const key = `${bucket.dayOfWeek}-${bucket.hour}`;
      aggregated.set(key, (aggregated.get(key) || 0) + 1);
    }

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

const ACTIVITY_HEATMAP_KEY = 'surfstats:player:activity-heatmap';
const ACTIVITY_HEATMAP_TTL = 3600; // 1 hour (data changes slowly)

export async function getActivityHeatmapFromCache(
  steamId: string,
  { force }: RefreshOptions = {}
): Promise<HeatmapDataPoint[] | null> {
  const cacheKey = `${ACTIVITY_HEATMAP_KEY}:${steamId}`;

  // A null result (analytics unavailable / invalid id / error) is not cached.
  return cachedFetch(cacheKey, ACTIVITY_HEATMAP_TTL, () => getPlayerActivityHeatmapInternal(steamId), { force });
}

interface MapEngagementRow extends RowDataPacket {
  map: string;
  sessions: number | string;
  total_seconds: number | string | null;
}

interface MapEngagementPoint {
  map: string;
  sessions: number;
  hours: number;
  avgMinutes: number;
}

async function getPlayerMapEngagementInternal(
  steamId: string
): Promise<MapEngagementPoint[] | null> {
  if (!isAnalyticsAvailable()) {
    return null;
  }

  const steamId3Numeric = convertSteamId2ToSteamId3Numeric(steamId);
  if (steamId3Numeric === null) {
    logger.warn(`[Analytics] Invalid SteamID format: ${steamId}`);
    return null;
  }

  try {
    const [rows] = await analyticsPool.query<MapEngagementRow[]>(`
      SELECT
        map,
        COUNT(*)      AS sessions,
        SUM(duration) AS total_seconds
      FROM player_analytics
      WHERE steamid3 = ?
      GROUP BY map
      ORDER BY total_seconds DESC
      LIMIT 10
    `, [steamId3Numeric]);

    return rows
      .filter((row) => row.map)
      .map((row) => {
        const sessions = Number(row.sessions) || 0;
        const seconds = Number(row.total_seconds) || 0;
        return {
          map: row.map,
          sessions,
          hours: seconds / 3600,
          avgMinutes: sessions > 0 ? seconds / sessions / 60 : 0,
        };
      });
  } catch (error: unknown) {
    logger.error(`[Analytics] Failed to fetch map engagement for ${steamId}: ${getErrorMessage(error)}`);
    return null;
  }
}

const MAP_ENGAGEMENT_KEY = 'surfstats:player:map-engagement';
const MAP_ENGAGEMENT_TTL = 3600; // 1 hour

export async function getPlayerMapEngagementFromCache(
  steamId: string,
  { force }: RefreshOptions = {}
): Promise<MapEngagementPoint[] | null> {
  const cacheKey = `${MAP_ENGAGEMENT_KEY}:${steamId}`;

  // A null result (analytics unavailable / invalid id / error) is not cached.
  return cachedFetch(cacheKey, MAP_ENGAGEMENT_TTL, () => getPlayerMapEngagementInternal(steamId), { force });
}

export type { MapEngagementPoint };
