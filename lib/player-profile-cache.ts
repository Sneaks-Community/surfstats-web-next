/**
 * Player Profile Cache
 * 
 * Caches player profile data including basic info, completed maps, bonuses, and stages.
 * Uses request deduplication to prevent cache stampede on high-traffic player profile pages.
 */

import 'server-only';
import pool from './db';
import type { RowDataPacket } from 'mysql2';
import { cachedFetch } from './cached-fetch';
import { withTimeout } from './timeout';
import { validateSteamId } from './validators';
import logger from './logger';
import { getErrorMessage } from './errors';

const PLAYER_PROFILE_KEY = 'surfstats:player:profile';
const PLAYER_OVERVIEW_KEY = 'surfstats:player:overview';
const PLAYER_WR_PERF_KEY = 'surfstats:player:wrperf';
const PLAYER_MAP_TIMES_KEY = 'surfstats:player:maptimes';
const PLAYER_BONUS_TIMES_KEY = 'surfstats:player:bonustimes';
const PLAYER_STAGE_TIMES_KEY = 'surfstats:player:stagetimes';
const PLAYER_INCOMPLETE_MAPS_KEY = 'surfstats:player:incomplete:maps';
const PLAYER_INCOMPLETE_BONUSES_KEY = 'surfstats:player:incomplete:bonuses';
const PLAYER_INCOMPLETE_STAGES_KEY = 'surfstats:player:incomplete:stages';
const PLAYER_TIER_DIST_KEY = 'surfstats:player:tierdist';
const PLAYER_PROFILE_TTL = 300; // 5 minutes
const QUERY_TIMEOUT_MS = 30000; // 30 seconds — per-query backstop

// Type definitions for cached profile data
export interface PlayerBasicInfo {
  steamid: string;
  name: string;
  country: string;
  points: number;
  lastseen: string;
  rank: number;
}

export interface PlayerMapTime {
  mapname: string;
  runtimepro: number;
  date: string;
  tier: number;
  wr_time: number | null;
  player_rank: number;
}

export interface PlayerBonusTime {
  mapname: string;
  zonegroup: number;
  runtime: number;
  date: string;
  player_rank: number;
}

export interface PlayerStageTime {
  map: string;
  stage: number;
  runtime: number;
  date: string;
  player_rank: number;
}

export interface CachedPlayerProfile {
  player: PlayerBasicInfo;
  maps: PlayerMapTime[];
  bonuses: PlayerBonusTime[];
  stages: PlayerStageTime[];
}

export interface PlayerCompletionCounts {
  maps: number;
  bonuses: number;
  stages: number;
}

/** One point per completed map for the Completion Percentile chart. */
export interface PlayerWrPerformancePoint {
  mapname: string;
  wrPercentage: number;
  tier: number;
  date: string;
}

/**
 * Cheap player overview: basic info + global rank + completion counts. Consumed
 * by the Overview tab's stat cards / progress bars. Deliberately avoids the
 * full per-section row lists and correlated rank subqueries — those live in the
 * `get*TimesFromCache` fetchers gated behind the Times tab click.
 */
export interface PlayerOverview {
  player: PlayerBasicInfo;
  counts: PlayerCompletionCounts;
}

export interface IncompleteMap {
  mapname: string;
  tier: number;
  wr_time: number | null;
  mapType: 'linear' | 'staged';
}

export interface IncompleteBonus {
  mapname: string;
  zonegroup: number;
  wr_time: number | null;
}

export interface IncompleteStage {
  map: string;
  stage: number;
}

export interface TierDistributionRow {
  tier: number;
  linear: number;
  staged: number;
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
      SELECT steamid, name, country, points, lastseen, \`rank\`
      FROM (
        SELECT
          steamid, name, country, points, lastseen,
          DENSE_RANK() OVER (ORDER BY points DESC) as \`rank\`
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
 * Cheap player overview for the server-rendered Overview tab.
 *
 * Returns basic player info, the global rank, and per-section completion
 * COUNT(*)s — but none of the expensive full row lists or correlated rank
 * subqueries. The global rank uses `COUNT(DISTINCT points) + 1` (over the rows
 * with strictly more points), which reproduces `DENSE_RANK() OVER (ORDER BY
 * points DESC)` exactly (ties share a rank, no gaps) while scanning far less
 * than a full-table window.
 *
 * @param steamid - The player's SteamID
 * @returns Overview data, or null if the SteamID is invalid / player not found
 */
export async function getPlayerOverviewFromCache(steamid: string): Promise<PlayerOverview | null> {
  const validSteamId = validateSteamId(steamid);
  if (!validSteamId) {
    logger.warn(`[PlayerProfileCache] Invalid SteamID for overview: ${steamid}`);
    return null;
  }

  // A null overview (player not found / query error) is never cached, so
  // subsequent requests keep retrying rather than pinning the absence.
  return cachedFetch<PlayerOverview | null>(
    `${PLAYER_OVERVIEW_KEY}:${validSteamId}`,
    PLAYER_PROFILE_TTL,
    async () => {
      const [playerRows] = await withTimeout(
        pool.query<RowDataPacket[]>(`
          SELECT
            pr.steamid, pr.name, pr.country, pr.points, pr.lastseen,
            (SELECT COUNT(DISTINCT points) + 1 FROM ck_playerrank WHERE points > pr.points) as \`rank\`
          FROM ck_playerrank pr
          WHERE pr.steamid = ?
        `, [validSteamId]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      if (playerRows.length === 0) {
        logger.warn(`[PlayerProfileCache] No player found with SteamID: ${validSteamId}`);
        return null;
      }

      const row = playerRows[0];
      const player: PlayerBasicInfo = {
        steamid: row.steamid,
        name: row.name,
        country: row.country,
        points: Number(row.points) || 0,
        lastseen: row.lastseen,
        // COUNT(...) can arrive as a string for BIGINT; coerce so callers get a
        // real number matching the old DENSE_RANK() value.
        rank: Number(row.rank) || 1,
      };

      const [countRows] = await withTimeout(
        pool.query<RowDataPacket[]>(`
          SELECT
            (SELECT COUNT(*) FROM ck_playertimes WHERE steamid = ?) as maps,
            (SELECT COUNT(*) FROM ck_bonus WHERE steamid = ?) as bonuses,
            (SELECT COUNT(*) FROM ck_stages WHERE steamid = ?) as stages
        `, [validSteamId, validSteamId, validSteamId]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      const counts: PlayerCompletionCounts = {
        maps: Number(countRows[0]?.maps) || 0,
        bonuses: Number(countRows[0]?.bonuses) || 0,
        stages: Number(countRows[0]?.stages) || 0,
      };

      return { player, counts };
    },
    {
      lock: true,
      onError: (error) => {
        logger.error(`[PlayerProfileCache] Failed to fetch overview for ${validSteamId}: ${getErrorMessage(error)}`);
        return null;
      },
    }
  );
}

/**
 * Data for the Completion Percentile chart: one `{ mapname, wrPercentage, tier,
 * date }` point per completed map.
 *
 * Deliberately cheap so it can render in the always-visible Overview (incl.
 * crawler hits): a player-bounded `WHERE steamid = ?` scan with **no** correlated
 * rank subquery, and the per-map WR time + tier come from the already-cached map
 * metadata — so it also avoids the full-table `MIN(...) GROUP BY`. WR here is the
 * same `MIN(runtimepro)` per map that the full map-times query uses, so the
 * plotted values match.
 *
 * @param steamid - The player's SteamID
 * @returns One point per completed map that has a WR time (empty on invalid id / error)
 */
export async function getPlayerWrPerformanceFromCache(steamid: string): Promise<PlayerWrPerformancePoint[]> {
  const validSteamId = validateSteamId(steamid);
  if (!validSteamId) {
    logger.warn(`[PlayerProfileCache] Invalid SteamID for WR performance: ${steamid}`);
    return [];
  }

  return cachedFetch<PlayerWrPerformancePoint[]>(
    `${PLAYER_WR_PERF_KEY}:${validSteamId}`,
    PLAYER_PROFILE_TTL,
    async () => {
      const { getAllMapMetadataFromCache } = await import('@/lib/valkey-map-cache');

      const [rows] = await withTimeout(
        pool.query<RowDataPacket[]>(`
          SELECT pt.mapname, pt.runtimepro, pt.date
          FROM ck_playertimes pt
          WHERE pt.steamid = ?
          ORDER BY pt.mapname ASC
        `, [validSteamId]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      const allMapMetadata = await getAllMapMetadataFromCache();

      const points: PlayerWrPerformancePoint[] = [];
      for (const row of rows) {
        const metadata = allMapMetadata.get(row.mapname);
        const wrTime = metadata?.wr_time ?? null;
        const runtime = Number(row.runtimepro);
        // Match the old client-side filter: needs a WR and a positive run time.
        if (wrTime == null || !(runtime > 0)) continue;
        points.push({
          mapname: row.mapname,
          wrPercentage: (wrTime / runtime) * 100,
          tier: metadata?.tier ?? 1,
          date: row.date,
        });
      }

      return points;
    },
    {
      lock: true,
      onError: (error) => {
        logger.error(`[PlayerProfileCache] Failed to fetch WR performance for ${validSteamId}: ${getErrorMessage(error)}`);
        return [];
      },
    }
  );
}

/**
 * Full list of the player's completed map times, with per-map WR time and the
 * player's rank on each map (correlated `COUNT(*)` rank subquery). Expensive —
 * routed through the single-flight lock + the expensive-query semaphore. Gated
 * behind the Times tab click.
 *
 * @param steamid - The player's SteamID
 * @returns Full map-times list (empty on invalid id / error)
 */
export async function getPlayerMapTimesFromCache(steamid: string): Promise<PlayerMapTime[]> {
  const validSteamId = validateSteamId(steamid);
  if (!validSteamId) {
    logger.warn(`[PlayerProfileCache] Invalid SteamID for map times: ${steamid}`);
    return [];
  }

  return cachedFetch<PlayerMapTime[]>(
    `${PLAYER_MAP_TIMES_KEY}:${validSteamId}`,
    PLAYER_PROFILE_TTL,
    async () => {
      const { getAllMapMetadataFromCache } = await import('@/lib/valkey-map-cache');
      const allMapMetadata = await getAllMapMetadataFromCache();

      const [maps] = await withTimeout(
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
        `, [validSteamId]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      // Look up tier from cache for each map (matches the old monolith).
      for (const map of maps) {
        const metadata = allMapMetadata.get(map.mapname);
        map.tier = metadata?.tier ?? 1;
      }

      return maps as PlayerMapTime[];
    },
    {
      lock: true,
      expensive: true,
      onError: (error) => {
        logger.error(`[PlayerProfileCache] Failed to fetch map times for ${validSteamId}: ${getErrorMessage(error)}`);
        return [];
      },
    }
  );
}

/**
 * Full list of the player's completed bonus times, with the player's rank on
 * each bonus zone (correlated `COUNT(*)` rank subquery). Expensive — gated
 * behind the Times tab click.
 *
 * @param steamid - The player's SteamID
 * @returns Full bonus-times list (empty on invalid id / error)
 */
export async function getPlayerBonusTimesFromCache(steamid: string): Promise<PlayerBonusTime[]> {
  const validSteamId = validateSteamId(steamid);
  if (!validSteamId) {
    logger.warn(`[PlayerProfileCache] Invalid SteamID for bonus times: ${steamid}`);
    return [];
  }

  return cachedFetch<PlayerBonusTime[]>(
    `${PLAYER_BONUS_TIMES_KEY}:${validSteamId}`,
    PLAYER_PROFILE_TTL,
    async () => {
      const [bonuses] = await withTimeout(
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
        `, [validSteamId]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      return bonuses as PlayerBonusTime[];
    },
    {
      lock: true,
      expensive: true,
      onError: (error) => {
        logger.error(`[PlayerProfileCache] Failed to fetch bonus times for ${validSteamId}: ${getErrorMessage(error)}`);
        return [];
      },
    }
  );
}

/**
 * Full list of the player's completed stage times, with the player's rank on
 * each stage (correlated `COUNT(*)` rank subquery). Expensive — gated behind
 * the Times tab click.
 *
 * @param steamid - The player's SteamID
 * @returns Full stage-times list (empty on invalid id / error)
 */
export async function getPlayerStageTimesFromCache(steamid: string): Promise<PlayerStageTime[]> {
  const validSteamId = validateSteamId(steamid);
  if (!validSteamId) {
    logger.warn(`[PlayerProfileCache] Invalid SteamID for stage times: ${steamid}`);
    return [];
  }

  return cachedFetch<PlayerStageTime[]>(
    `${PLAYER_STAGE_TIMES_KEY}:${validSteamId}`,
    PLAYER_PROFILE_TTL,
    async () => {
      const [stages] = await withTimeout(
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
        `, [validSteamId]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      return stages as PlayerStageTime[];
    },
    {
      lock: true,
      expensive: true,
      onError: (error) => {
        logger.error(`[PlayerProfileCache] Failed to fetch stage times for ${validSteamId}: ${getErrorMessage(error)}`);
        return [];
      },
    }
  );
}

/**
 * Maps the player has NOT completed (anti-join against the full map list), with
 * tier, WR time, and the linear/staged classification. Expensive — gated behind
 * the Times → Map sub-tab.
 *
 * @param steamid - The player's SteamID
 * @returns Incomplete-maps list (empty on invalid id / error)
 */
export async function getIncompleteMapsFromCache(steamid: string): Promise<IncompleteMap[]> {
  const validSteamId = validateSteamId(steamid);
  if (!validSteamId) {
    logger.warn(`[PlayerProfileCache] Invalid SteamID for incomplete maps: ${steamid}`);
    return [];
  }

  return cachedFetch<IncompleteMap[]>(
    `${PLAYER_INCOMPLETE_MAPS_KEY}:${validSteamId}`,
    PLAYER_PROFILE_TTL,
    async () => {
      const { getAllMapMetadataFromCache } = await import('@/lib/valkey-map-cache');

      const [rows] = await withTimeout(
        pool.query<RowDataPacket[]>(`
          SELECT
            m.mapname,
            COALESCE(m.tier, 1) as tier,
            wr.min_runtime as wr_time
          FROM ck_maptier m
          LEFT JOIN ck_playertimes pt ON m.mapname = pt.mapname AND pt.steamid = ?
          LEFT JOIN (
            SELECT mapname, MIN(runtimepro) as min_runtime
            FROM ck_playertimes
            GROUP BY mapname
          ) wr ON m.mapname = wr.mapname
          WHERE pt.mapname IS NULL
          ORDER BY m.tier ASC, m.mapname ASC
        `, [validSteamId]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      const allMapMetadata = await getAllMapMetadataFromCache();
      return rows.map(r => {
        const mapMetadata = allMapMetadata.get(r.mapname);
        const mapType: 'linear' | 'staged' = mapMetadata && mapMetadata.stages > 1 ? 'staged' : 'linear';
        return {
          mapname: r.mapname,
          tier: r.tier,
          wr_time: r.wr_time,
          mapType,
        };
      });
    },
    {
      lock: true,
      expensive: true,
      onError: (error) => {
        logger.error(`[PlayerProfileCache] Failed to fetch incomplete maps for ${validSteamId}: ${getErrorMessage(error)}`);
        return [];
      },
    }
  );
}

/**
 * Bonus zones the player has NOT completed (anti-join against the full bonus
 * zone list). Expensive — gated behind the Times → Bonus sub-tab.
 *
 * @param steamid - The player's SteamID
 * @returns Incomplete-bonuses list (empty on invalid id / error)
 */
export async function getIncompleteBonusesFromCache(steamid: string): Promise<IncompleteBonus[]> {
  const validSteamId = validateSteamId(steamid);
  if (!validSteamId) {
    logger.warn(`[PlayerProfileCache] Invalid SteamID for incomplete bonuses: ${steamid}`);
    return [];
  }

  return cachedFetch<IncompleteBonus[]>(
    `${PLAYER_INCOMPLETE_BONUSES_KEY}:${validSteamId}`,
    PLAYER_PROFILE_TTL,
    async () => {
      const [rows] = await withTimeout(
        pool.query<RowDataPacket[]>(`
          SELECT
            z.mapname,
            z.zonegroup,
            wr.min_runtime as wr_time
          FROM ck_zones z
          LEFT JOIN ck_bonus br ON z.mapname = br.mapname AND z.zonegroup = br.zonegroup AND br.steamid = ?
          LEFT JOIN (
            SELECT mapname, zonegroup, MIN(runtime) as min_runtime
            FROM ck_bonus
            GROUP BY mapname, zonegroup
          ) wr ON z.mapname = wr.mapname AND z.zonegroup = wr.zonegroup
          WHERE z.zonetype = 2 AND z.zonegroup > 0 AND br.mapname IS NULL
          ORDER BY z.mapname ASC, z.zonegroup ASC
        `, [validSteamId]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      return rows.map(r => ({
        mapname: r.mapname,
        zonegroup: r.zonegroup,
        wr_time: r.wr_time,
      }));
    },
    {
      lock: true,
      expensive: true,
      onError: (error) => {
        logger.error(`[PlayerProfileCache] Failed to fetch incomplete bonuses for ${validSteamId}: ${getErrorMessage(error)}`);
        return [];
      },
    }
  );
}

/**
 * Stages the player has NOT completed (anti-join against the full stage list).
 * Expensive — gated behind the Times → Stage sub-tab.
 *
 * @param steamid - The player's SteamID
 * @returns Incomplete-stages list (empty on invalid id / error)
 */
export async function getIncompleteStagesFromCache(steamid: string): Promise<IncompleteStage[]> {
  const validSteamId = validateSteamId(steamid);
  if (!validSteamId) {
    logger.warn(`[PlayerProfileCache] Invalid SteamID for incomplete stages: ${steamid}`);
    return [];
  }

  return cachedFetch<IncompleteStage[]>(
    `${PLAYER_INCOMPLETE_STAGES_KEY}:${validSteamId}`,
    PLAYER_PROFILE_TTL,
    async () => {
      const [rows] = await withTimeout(
        pool.query<RowDataPacket[]>(`
          SELECT
            z.mapname as map,
            z.zonetypeid as stage
          FROM ck_zones z
          LEFT JOIN ck_stages sr ON z.mapname = sr.map AND z.zonetypeid = sr.stage AND sr.steamid = ?
          WHERE z.zonetype = 3 AND z.zonegroup = 0 AND z.zonetypeid > 0 AND sr.map IS NULL
          ORDER BY z.mapname ASC, z.zonetypeid ASC
        `, [validSteamId]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      return rows.map(r => ({
        map: r.map,
        stage: r.stage,
      }));
    },
    {
      lock: true,
      expensive: true,
      onError: (error) => {
        logger.error(`[PlayerProfileCache] Failed to fetch incomplete stages for ${validSteamId}: ${getErrorMessage(error)}`);
        return [];
      },
    }
  );
}

/**
 * Player's linear/staged completion counts per tier, returning only the tiers
 * the player has actually completed (no zero-padding — the caller pads across
 * the server's real tier range). Cached so the Tier Distribution aggregate no
 * longer runs uncached on every player-page render.
 *
 * @param steamid - The player's SteamID
 * @returns Per-tier rows (empty on invalid id / error)
 */
export async function getLinearVsStagedPerTierFromCache(steamid: string): Promise<TierDistributionRow[]> {
  const validSteamId = validateSteamId(steamid);
  if (!validSteamId) {
    logger.warn(`[PlayerProfileCache] Invalid SteamID for tier distribution: ${steamid}`);
    return [];
  }

  return cachedFetch<TierDistributionRow[]>(
    `${PLAYER_TIER_DIST_KEY}:${validSteamId}`,
    PLAYER_PROFILE_TTL,
    async () => {
      const [rows] = await withTimeout(
        pool.query<RowDataPacket[]>(`
          SELECT
            COALESCE(m.tier, 1) as \`tier\`,
            COALESCE(SUM(CASE WHEN staged_map.mapname IS NULL THEN 1 ELSE 0 END), 0) as \`linear\`,
            COALESCE(SUM(CASE WHEN staged_map.mapname IS NOT NULL THEN 1 ELSE 0 END), 0) as \`staged\`
          FROM ck_maptier m
          INNER JOIN ck_playertimes pt ON m.mapname = pt.mapname AND pt.steamid = ?
          LEFT JOIN (
            SELECT DISTINCT mapname FROM ck_zones WHERE zonetype = 3
          ) staged_map ON m.mapname = staged_map.mapname
          GROUP BY m.tier
          ORDER BY m.tier ASC
        `, [validSteamId]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      // MySQL returns SUM/tier as strings, so convert them here.
      return rows.map(row => ({
        tier: Number(row.tier),
        linear: Number(row.linear) || 0,
        staged: Number(row.staged) || 0,
      }));
    },
    {
      lock: true,
      expensive: true,
      onError: (error) => {
        logger.error(`[PlayerProfileCache] Failed to fetch tier distribution for ${validSteamId}: ${getErrorMessage(error)}`);
        return [];
      },
    }
  );
}

