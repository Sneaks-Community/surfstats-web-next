/**
 * Player Profile Cache
 * 
 * Caches player profile data including basic info, completed maps, bonuses, and stages.
 * Uses request deduplication to prevent cache stampede on high-traffic player profile pages.
 */

import 'server-only';
import pool from './db';
import type { RowDataPacket } from 'mysql2';
import { cachedFetch, type RefreshOptions } from './cached-fetch';
import { getAllMapMetadataFromCache, isStagedMap } from './map-cache';
import { withTimeout } from './timeout';
import { validateSteamId } from './validators';
import { recordProfileView } from './recent-profiles';
import logger from './logger';
import { getErrorMessage } from './errors';

const PLAYER_OVERVIEW_KEY = 'surfstats:player:overview';
const PLAYER_WR_PERF_KEY = 'surfstats:player:wrperf';
const PLAYER_MAP_TIMES_KEY = 'surfstats:player:maptimes';
const PLAYER_BONUS_TIMES_KEY = 'surfstats:player:bonustimes';
const PLAYER_STAGE_TIMES_KEY = 'surfstats:player:stagetimes';
const PLAYER_INCOMPLETE_MAPS_KEY = 'surfstats:player:incomplete:maps';
const PLAYER_INCOMPLETE_BONUSES_KEY = 'surfstats:player:incomplete:bonuses';
const PLAYER_INCOMPLETE_STAGES_KEY = 'surfstats:player:incomplete:stages';
const PLAYER_TIER_DIST_KEY = 'surfstats:player:tierdist';
// The recently-viewed warmer refreshes the render keys every 15 minutes, so the TTL
// is the safety net rather than the freshness guarantee. Profiles outside that set
// are on-demand and stale for up to an hour.
const PLAYER_PROFILE_TTL = 3600; // 1 hour
const QUERY_TIMEOUT_MS = 30000; // 30 seconds — per-query backstop

// Type definitions for cached profile data
export interface PlayerBasicInfo {
  steamid: string;
  name: string;
  country: string;
  points: number;
  lastseen: string;
  /** Null for 0-point players: they are excluded from every ranked listing. */
  rank: number | null;
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
 * Cheap player overview for the server-rendered Overview tab.
 *
 * Returns basic player info, the global rank, and per-section completion counts
 * in one round trip — but none of the expensive full row lists or correlated
 * rank subqueries. Maps completed is `ck_playerrank.finishedmaps` off the row
 * being read; bonuses and stages are scalar `COUNT(*)` subqueries. The global rank uses `COUNT(*) + 1` over the rows with strictly
 * more points, reproducing the players list's `RANK() OVER (ORDER BY points
 * DESC)` (ties share a rank, gaps after) without a full-table window. Players
 * with 0 points are absent from that list, so their rank is null (Unranked).
 *
 * @param steamid - The player's SteamID
 * @returns Overview data, or null if the SteamID is invalid / player not found
 */
export async function getPlayerOverviewFromCache(steamid: string, { force }: RefreshOptions = {}): Promise<PlayerOverview | null> {
  const validSteamId = validateSteamId(steamid);
  if (!validSteamId) {
    logger.warn(`[PlayerProfileCache] Invalid SteamID for overview: ${steamid}`);
    return null;
  }

  // A null overview (player not found / query error) is never cached, so
  // subsequent requests keep retrying rather than pinning the absence.
  const overview = await cachedFetch<PlayerOverview | null>(
    `${PLAYER_OVERVIEW_KEY}:${validSteamId}`,
    PLAYER_PROFILE_TTL,
    async () => {
      const [playerRows] = await withTimeout(
        pool.query<RowDataPacket[]>(`
          SELECT
            pr.steamid, pr.name, pr.country, pr.points, pr.lastseen,
            pr.finishedmaps as maps,
            CASE WHEN pr.points > 0
              THEN (SELECT COUNT(*) + 1 FROM ck_playerrank WHERE points > pr.points)
            END as \`rank\`,
            (SELECT COUNT(*) FROM ck_bonus WHERE steamid = pr.steamid) as bonuses,
            (SELECT COUNT(*) FROM ck_stages WHERE steamid = pr.steamid) as stages
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
        // COUNT(...) can arrive as a string for BIGINT; null means unranked.
        rank: row.rank === null ? null : Number(row.rank) || 1,
      };

      const counts: PlayerCompletionCounts = {
        maps: Number(row.maps) || 0,
        bonuses: Number(row.bonuses) || 0,
        stages: Number(row.stages) || 0,
      };

      return { player, counts };
    },
    {
      lock: true,
      force,
      onError: (error) => {
        logger.error(`[PlayerProfileCache] Failed to fetch overview for ${validSteamId}: ${getErrorMessage(error)}`);
        return null;
      },
    }
  );

  // Every profile view calls this, and nothing else does, so it is where the warm
  // set is fed. Recorded only for a player that exists: recording first let a
  // sweep of made-up numeric ids evict all 100 real profiles. Skipped on a forced
  // refresh: that is the warmer itself, and re-recording would keep the same 100
  // profiles in the set forever.
  if (!force && overview) recordProfileView(validSteamId);
  return overview;
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
export async function getPlayerWrPerformanceFromCache(steamid: string, { force }: RefreshOptions = {}): Promise<PlayerWrPerformancePoint[]> {
  const validSteamId = validateSteamId(steamid);
  if (!validSteamId) {
    logger.warn(`[PlayerProfileCache] Invalid SteamID for WR performance: ${steamid}`);
    return [];
  }

  return cachedFetch<PlayerWrPerformancePoint[]>(
    `${PLAYER_WR_PERF_KEY}:${validSteamId}`,
    PLAYER_PROFILE_TTL,
    async () => {
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
      force,
      onError: (error) => {
        logger.error(`[PlayerProfileCache] Failed to fetch WR performance for ${validSteamId}: ${getErrorMessage(error)}`);
        return [];
      },
    }
  );
}

/**
 * Full list of the player's completed map times, with the player's rank on each
 * map (correlated `COUNT(*)` rank subquery); tier and WR time come from the
 * cached map metadata rather than a second full-table aggregate. Expensive —
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
      const allMapMetadata = await getAllMapMetadataFromCache();

      const [maps] = await withTimeout(
        pool.query<RowDataPacket[]>(`
          SELECT
            pt.mapname,
            pt.runtimepro,
            pt.date,
            (SELECT COUNT(*) + 1 FROM ck_playertimes pt2
             WHERE pt2.mapname = pt.mapname AND pt2.runtimepro < pt.runtimepro) as player_rank
          FROM ck_playertimes pt
          WHERE pt.steamid = ?
          ORDER BY pt.mapname ASC
        `, [validSteamId]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      // Tier and WR come from the cached metadata; a miss means the map is
      // untiered or outside tiers 1-10, so it drops out of the list.
      const tiered: RowDataPacket[] = [];
      for (const map of maps) {
        const metadata = allMapMetadata.get(map.mapname);
        if (!metadata) continue;
        map.tier = metadata.tier;
        map.wr_time = metadata.wr_time;
        tiered.push(map);
      }

      return tiered as PlayerMapTime[];
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
 * tier from the map row and WR + linear/staged from the cached metadata (a map
 * missing there has no completions, so its WR is null either way). Expensive —
 * gated behind the Times → Map sub-tab.
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
      const [rows] = await withTimeout(
        pool.query<RowDataPacket[]>(`
          SELECT
            m.mapname,
            m.tier
          FROM ck_maptier m
          LEFT JOIN ck_playertimes pt ON m.mapname = pt.mapname AND pt.steamid = ?
          WHERE pt.mapname IS NULL AND m.tier BETWEEN 1 AND 10
          ORDER BY m.tier ASC, m.mapname ASC
        `, [validSteamId]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      const allMapMetadata = await getAllMapMetadataFromCache();
      return rows.map(r => {
        const mapMetadata = allMapMetadata.get(r.mapname);
        const mapType: 'linear' | 'staged' = mapMetadata && isStagedMap(mapMetadata) ? 'staged' : 'linear';
        return {
          mapname: r.mapname,
          tier: r.tier,
          wr_time: mapMetadata?.wr_time ?? null,
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
 * Building the stage universe from `ck_zones` needs two corrections, both
 * verified against the live DB (see AGENTS.md's zone model):
 *
 * - `zonetypeid` is 0-based stage *ordering* (id 0 = Stage 1) while
 *   `ck_stages.stage` is 1-based, so the join needs `zonetypeid + 1`. It is
 *   contiguous `0..N-1` on every map, and `min` is always 0.
 * - A staged map's final stage ends at the map end zone, so it has no
 *   `zonetype = 3` row at all. Stage `N + 1` therefore has to be added per map,
 *   which is the same `COUNT(*) + 1` {@link fetchAllMapMetadata} counts.
 *
 * Without both, Stage 1 was excluded, every remaining stage was reported one
 * lower than its real number, and the last stage of every map was invisible.
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
          SELECT all_stages.map, all_stages.stage
          FROM (
            SELECT mapname AS map, zonetypeid + 1 AS stage
            FROM ck_zones
            WHERE zonetype = 3 AND zonegroup = 0
            UNION ALL
            SELECT mapname AS map, MAX(zonetypeid) + 2 AS stage
            FROM ck_zones
            WHERE zonetype = 3 AND zonegroup = 0
            GROUP BY mapname
          ) all_stages
          LEFT JOIN ck_stages sr
            ON all_stages.map = sr.map AND all_stages.stage = sr.stage AND sr.steamid = ?
          WHERE sr.map IS NULL
          ORDER BY all_stages.map ASC, all_stages.stage ASC
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
export async function getLinearVsStagedPerTierFromCache(steamid: string, { force }: RefreshOptions = {}): Promise<TierDistributionRow[]> {
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
            m.tier,
            COALESCE(SUM(CASE WHEN staged_map.mapname IS NULL THEN 1 ELSE 0 END), 0) as \`linear\`,
            COALESCE(SUM(CASE WHEN staged_map.mapname IS NOT NULL THEN 1 ELSE 0 END), 0) as \`staged\`
          FROM ck_maptier m
          INNER JOIN ck_playertimes pt ON m.mapname = pt.mapname AND pt.steamid = ?
          LEFT JOIN (
            SELECT DISTINCT mapname FROM ck_zones WHERE zonetype = 3
          ) staged_map ON m.mapname = staged_map.mapname
          WHERE m.tier BETWEEN 1 AND 10
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
      force,
      expensive: true,
      onError: (error) => {
        logger.error(`[PlayerProfileCache] Failed to fetch tier distribution for ${validSteamId}: ${getErrorMessage(error)}`);
        return [];
      },
    }
  );
}

