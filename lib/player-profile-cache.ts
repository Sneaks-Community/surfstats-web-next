/**
 * Player Profile Cache
 * 
 * Caches player profile data including basic info, completed maps, bonuses, and stages.
 * Uses request deduplication to prevent cache stampede on high-traffic player profile pages.
 */

import 'server-only';
import pool from './db';
import type { RowDataPacket } from 'mysql2';
import { cacheDelete } from './valkey-cache';
import { cachedFetch } from './cached-fetch';
import logger from './logger';
import { getErrorMessage } from './errors';

const PLAYER_PROFILE_KEY = 'surfstats:player:profile';
const PLAYER_PROFILE_TTL = 300; // 5 minutes

// Type definitions for cached profile data
export interface CachedPlayerProfile {
  player: {
    steamid: string;
    name: string;
    country: string;
    points: number;
    lastseen: string;
    rank: number;
  };
  maps: Array<{
    mapname: string;
    runtimepro: number;
    date: string;
    tier: number;
    wr_time: number | null;
    player_rank: number;
  }>;
  bonuses: Array<{
    mapname: string;
    zonegroup: number;
    runtime: number;
    date: string;
    player_rank: number;
  }>;
  stages: Array<{
    map: string;
    stage: number;
    runtime: number;
    date: string;
    player_rank: number;
  }>;
}

/**
 * Internal function to fetch player profile data from database
 * This is the raw query function without caching
 */
async function getPlayerProfileInternal(steamid: string): Promise<CachedPlayerProfile | null> {
  logger.debug(`[PlayerProfileCache] Fetching profile for: ${steamid}`);

  try {
    // Get basic player info and rank
    // Wrap window function in subquery so DENSE_RANK evaluates on full table,
    // then filter to the requested player. This fixes the bug where the WHERE
    // clause filtered to a single row before the window function ran, always
    // returning rank 1.
    const [playerRows] = await pool.query<RowDataPacket[]>(`
      SELECT steamid, name, country, points, lastseen, rank
      FROM (
        SELECT
          steamid, name, country, points, lastseen,
          DENSE_RANK() OVER (ORDER BY points DESC) as rank
        FROM ck_playerrank
      ) ranked
      WHERE steamid = ?
    `, [steamid]);

    if (playerRows.length === 0) {
      logger.warn(`[PlayerProfileCache] No player found with SteamID: ${steamid}`);
      return null;
    }

    const player = playerRows[0];

    // Fetch all map metadata from Valkey cache once
    const { getAllMapMetadataFromCache } = await import('@/lib/valkey-map-cache');
    const allMapMetadata = await getAllMapMetadataFromCache();

    // PARALLEL: Fetch maps, bonuses, and stages simultaneously
    const [mapsResult, bonusesResult, stagesResult] = await Promise.all([
      pool.query<RowDataPacket[]>(`
        SELECT
          pt.mapname,
          pt.runtimepro,
          pt.date,
          wr.min_runtime as wr_time,
          (SELECT COUNT(*) + 1 FROM ck_playertimes pt2
           WHERE pt2.mapname = pt.mapname AND pt2.runtimepro < pt.runtimepro) as player_rank
        FROM ck_playertimes pt
        LEFT JOIN (
          SELECT mapname, MIN(runtimepro) as min_runtime
          FROM ck_playertimes
          GROUP BY mapname
        ) wr ON pt.mapname = wr.mapname
        WHERE pt.steamid = ?
        ORDER BY pt.mapname ASC
      `, [steamid]),
      pool.query<RowDataPacket[]>(`
        SELECT
          b.mapname,
          b.zonegroup,
          b.runtime,
          b.date,
          (SELECT COUNT(*) + 1 FROM ck_bonus b2
           WHERE b2.mapname = b.mapname AND b2.zonegroup = b.zonegroup AND b2.runtime < b.runtime) as player_rank
        FROM ck_bonus b
        WHERE b.steamid = ?
        ORDER BY b.mapname ASC, b.zonegroup ASC
      `, [steamid]),
      pool.query<RowDataPacket[]>(`
        SELECT
          s.map,
          s.stage,
          s.runtime,
          s.date,
          (SELECT COUNT(*) + 1 FROM ck_stages s2
           WHERE s2.map = s.map AND s2.stage = s.stage AND s2.runtime < s.runtime) as player_rank
        FROM ck_stages s
        WHERE s.steamid = ?
        ORDER BY s.map ASC, s.stage ASC
      `, [steamid])
    ]);

    const [maps] = mapsResult;
    const [bonuses] = bonusesResult;
    const [stages] = stagesResult;

    // Look up tier from cache for each map
    for (const map of maps) {
      const metadata = allMapMetadata.get(map.mapname);
      map.tier = metadata?.tier ?? 1;
    }

    logger.debug(`[PlayerProfileCache] Profile loaded for ${player.name} (${steamid}): ${maps.length} maps, ${bonuses.length} bonuses, ${stages.length} stages`);

    return {
      player: player as {
        steamid: string;
        name: string;
        country: string;
        points: number;
        lastseen: string;
        rank: number;
      },
      maps: maps as Array<{
        mapname: string;
        runtimepro: number;
        date: string;
        tier: number;
        wr_time: number | null;
        player_rank: number;
      }>,
      bonuses: bonuses as Array<{
        mapname: string;
        zonegroup: number;
        runtime: number;
        date: string;
        player_rank: number;
      }>,
      stages: stages as Array<{
        map: string;
        stage: number;
        runtime: number;
        date: string;
        player_rank: number;
      }>,
    };
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    logger.error(`[PlayerProfileCache] Failed to fetch profile for ${steamid}: ${errorMessage}`);
    return null;
  }
}

/**
 * Get player profile from Valkey cache with request deduplication
 * 
 * Caches complete player profile data including:
 * - Basic player info (steamid, name, country, points, rank)
 * - Completed maps with WR times and player rank
 * - Completed bonuses with player rank
 * - Completed stages with player rank
 * 
 * Uses CacheLock to prevent cache stampede when multiple requests
 * miss the cache simultaneously.
 * 
 * @param steamid - The player's SteamID
 * @returns Cached player profile or null if player not found
 */
export async function getPlayerProfileFromCache(steamid: string): Promise<CachedPlayerProfile | null> {
  // A null profile (player not found / query error) is never cached, so
  // subsequent requests keep retrying rather than caching the absence.
  return cachedFetch(
    `${PLAYER_PROFILE_KEY}:${steamid}`,
    PLAYER_PROFILE_TTL,
    () => getPlayerProfileInternal(steamid),
    { lock: true }
  );
}

/**
 * Invalidate player profile cache
 * Called when a player completes a map/bonus/stage
 * 
 * @param steamid - The player's SteamID
 */
export async function invalidatePlayerProfileCache(steamid: string): Promise<void> {
  const cacheKey = `${PLAYER_PROFILE_KEY}:${steamid}`;
  // Delete the cache key directly instead of setting with 0 TTL
  await cacheDelete(cacheKey);
  logger.debug(`[PlayerProfileCache] Invalidated cache for ${steamid}`);
}
