import 'server-only';
import pool from './db';
import type { RowDataPacket } from 'mysql2';
import { cachedFetch, type RefreshOptions } from './cached-fetch';
import { getAllMapMetadataFromCache } from './map-cache';
import { isStagedMap } from './utils';
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
// Safety net for profiles the recently-viewed warmer refreshes every 15 min; the rest are
// on demand and stale for up to an hour.
const PLAYER_PROFILE_TTL = 3600;

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

/** One point per completed map, for the Completion Percentile chart. */
export interface PlayerWrPerformancePoint {
  mapname: string;
  wrPercentage: number;
  tier: number;
  date: string;
}

/** Cheap Overview-tab data: no full row lists or rank subqueries, which live in the
 * `get*TimesFromCache` fetchers behind the Times tab. */
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

/** Shared per-player cache: validates the SteamID, keys `<key>:<steamid>`, single-flight lock.
 * Resolves to `empty` (never cached) on an invalid SteamID or a failed fetch. */
function playerCachedFetch<T>({
  steamid,
  key,
  label,
  empty,
  fetch,
  expensive = false,
  force,
}: {
  steamid: string;
  key: string;
  /** Names the data in log lines, e.g. "map times". */
  label: string;
  empty: T;
  fetch: (validSteamId: string) => Promise<T>;
  expensive?: boolean;
  force?: boolean;
}): Promise<T> {
  const validSteamId = validateSteamId(steamid);
  if (!validSteamId) {
    logger.warn(`[PlayerProfileCache] Invalid SteamID for ${label}: ${steamid}`);
    return Promise.resolve(empty);
  }

  return cachedFetch<T>(`${key}:${validSteamId}`, PLAYER_PROFILE_TTL, () => fetch(validSteamId), {
    lock: true,
    expensive,
    force,
    onError: (error) => {
      logger.error(`[PlayerProfileCache] Failed to fetch ${label} for ${validSteamId}: ${getErrorMessage(error)}`);
      return empty;
    },
  });
}

/** Info, rank and completion counts for the Overview tab in one round trip.
 * Null (not cached, so retried) when the SteamID is invalid or the player is not found. */
export async function getPlayerOverviewFromCache(steamid: string, { force }: RefreshOptions = {}): Promise<PlayerOverview | null> {
  const overview = await playerCachedFetch<PlayerOverview | null>({
    steamid,
    key: PLAYER_OVERVIEW_KEY,
    label: 'overview',
    empty: null,
    force,
    fetch: async (validSteamId) => {
      // Rank as COUNT(*) + 1 over higher points equals the players list's RANK() (ties share, gaps
      // after) without a full-table window. Maps is finishedmaps, not a ck_playertimes count.
      const [playerRows] = await pool.query<RowDataPacket[]>(`
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
      `, [validSteamId]);

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
  });

  // Only profile views call this, so it feeds the warm set. Real players only, so fake-id sweeps
  // can't evict it; skipped when forced (the warmer), or the same 100 would stay forever.
  if (!force && overview) recordProfileView(overview.player.steamid);
  return overview;
}

/** Completion Percentile chart data, kept cheap for the always-visible Overview (and crawlers): no
 * rank subquery, and WR/tier come from map metadata, the same WR the map-times list uses. */
export async function getPlayerWrPerformanceFromCache(steamid: string, { force }: RefreshOptions = {}): Promise<PlayerWrPerformancePoint[]> {
  return playerCachedFetch<PlayerWrPerformancePoint[]>({
    steamid,
    key: PLAYER_WR_PERF_KEY,
    label: 'WR performance',
    empty: [],
    force,
    fetch: async (validSteamId) => {
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT pt.mapname, pt.runtimepro, pt.date
        FROM ck_playertimes pt
        WHERE pt.steamid = ?
        ORDER BY pt.mapname ASC
      `, [validSteamId]);

      const allMapMetadata = await getAllMapMetadataFromCache();

      const points: PlayerWrPerformancePoint[] = [];
      for (const row of rows) {
        const metadata = allMapMetadata.get(row.mapname);
        const wrTime = metadata?.wr_time ?? null;
        const runtime = Number(row.runtimepro);
        // Needs a WR and a positive run time.
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
  });
}

/** Every completed map with the player's rank on it (correlated subquery, so `expensive`); gated
 * behind the Times tab. Tier and WR come from map metadata, not a second full-table aggregate. */
export async function getPlayerMapTimesFromCache(steamid: string): Promise<PlayerMapTime[]> {
  return playerCachedFetch<PlayerMapTime[]>({
    steamid,
    key: PLAYER_MAP_TIMES_KEY,
    label: 'map times',
    empty: [],
    expensive: true,
    fetch: async (validSteamId) => {
      const allMapMetadata = await getAllMapMetadataFromCache();

      const [maps] = await pool.query<RowDataPacket[]>(`
        SELECT
          pt.mapname,
          pt.runtimepro,
          pt.date,
          (SELECT COUNT(*) + 1 FROM ck_playertimes pt2
           WHERE pt2.mapname = pt.mapname AND pt2.runtimepro < pt.runtimepro) as player_rank
        FROM ck_playertimes pt
        WHERE pt.steamid = ?
        ORDER BY pt.mapname ASC
      `, [validSteamId]);

      // A metadata miss means the map is untiered or outside tiers 1-10, so it drops out.
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
  });
}

/** Completed bonuses with the player's rank per zone (correlated subquery); behind the Times tab. */
export async function getPlayerBonusTimesFromCache(steamid: string): Promise<PlayerBonusTime[]> {
  return playerCachedFetch<PlayerBonusTime[]>({
    steamid,
    key: PLAYER_BONUS_TIMES_KEY,
    label: 'bonus times',
    empty: [],
    expensive: true,
    fetch: async (validSteamId) => {
      const [bonuses] = await pool.query<RowDataPacket[]>(`
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
      `, [validSteamId]);

      return bonuses as PlayerBonusTime[];
    },
  });
}

/** Completed stages with the player's rank on each (correlated subquery); behind the Times tab. */
export async function getPlayerStageTimesFromCache(steamid: string): Promise<PlayerStageTime[]> {
  return playerCachedFetch<PlayerStageTime[]>({
    steamid,
    key: PLAYER_STAGE_TIMES_KEY,
    label: 'stage times',
    empty: [],
    expensive: true,
    fetch: async (validSteamId) => {
      const [stages] = await pool.query<RowDataPacket[]>(`
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
      `, [validSteamId]);

      return stages as PlayerStageTime[];
    },
  });
}

/** Map metadata minus the player's times. Same universe as /maps (tier 1-10, at least one
 * completion), so a map nobody has finished is not listed. Gated behind the Map sub-tab. */
export async function getIncompleteMapsFromCache(steamid: string): Promise<IncompleteMap[]> {
  return playerCachedFetch<IncompleteMap[]>({
    steamid,
    key: PLAYER_INCOMPLETE_MAPS_KEY,
    label: 'incomplete maps',
    empty: [],
    fetch: async (validSteamId) => {
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT mapname
        FROM ck_playertimes
        WHERE steamid = ?
      `, [validSteamId]);

      const completed = new Set(rows.map(r => r.mapname));
      const allMapMetadata = await getAllMapMetadataFromCache();

      return Array.from(allMapMetadata.values())
        .filter(m => !completed.has(m.mapname))
        .sort((a, b) => a.tier - b.tier || a.mapname.localeCompare(b.mapname))
        .map(m => ({
          mapname: m.mapname,
          tier: m.tier,
          wr_time: m.wr_time,
          mapType: isStagedMap(m) ? 'staged' : 'linear',
        }));
    },
  });
}

/** Anti-join over all bonus zones, limited to map-metadata maps so the universe matches /maps.
 * Expensive, so gated behind the Bonus sub-tab. */
export async function getIncompleteBonusesFromCache(steamid: string): Promise<IncompleteBonus[]> {
  return playerCachedFetch<IncompleteBonus[]>({
    steamid,
    key: PLAYER_INCOMPLETE_BONUSES_KEY,
    label: 'incomplete bonuses',
    empty: [],
    expensive: true,
    fetch: async (validSteamId) => {
      const [rows] = await pool.query<RowDataPacket[]>(`
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
      `, [validSteamId]);

      const allMapMetadata = await getAllMapMetadataFromCache();
      return rows
        .filter(r => allMapMetadata.has(r.mapname))
        .map(r => ({
          mapname: r.mapname,
          zonegroup: r.zonegroup,
          wr_time: r.wr_time,
        }));
    },
  });
}

/** Anti-join over all stages, limited to map-metadata maps so the universe matches /maps.
 * Expensive, so gated behind the Stage sub-tab. */
export async function getIncompleteStagesFromCache(steamid: string): Promise<IncompleteStage[]> {
  return playerCachedFetch<IncompleteStage[]>({
    steamid,
    key: PLAYER_INCOMPLETE_STAGES_KEY,
    label: 'incomplete stages',
    empty: [],
    expensive: true,
    fetch: async (validSteamId) => {
      // zonetypeid is contiguous 0..N-1 (id 0 = Stage 1) but ck_stages.stage is 1-based, hence + 1.
      // The final stage ends at the map end zone with no zonetype 3 row, so MAX + 2 adds it
      // (the same COUNT(*) + 1 fetchAllMapMetadata counts).
      const [rows] = await pool.query<RowDataPacket[]>(`
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
      `, [validSteamId]);

      const allMapMetadata = await getAllMapMetadataFromCache();
      return rows
        .filter(r => allMapMetadata.has(r.map))
        .map(r => ({
          map: r.map,
          stage: r.stage,
        }));
    },
  });
}

/** Linear/staged completions per tier, only for tiers the player has completed; the caller pads
 * across the server's tier range. */
export async function getLinearVsStagedPerTierFromCache(steamid: string, { force }: RefreshOptions = {}): Promise<TierDistributionRow[]> {
  return playerCachedFetch<TierDistributionRow[]>({
    steamid,
    key: PLAYER_TIER_DIST_KEY,
    label: 'tier distribution',
    empty: [],
    force,
    fetch: async (validSteamId) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT mapname FROM ck_playertimes WHERE steamid = ?',
        [validSteamId]
      );
      const allMapMetadata = await getAllMapMetadataFromCache();

      const byTier = new Map<number, TierDistributionRow>();
      for (const { mapname } of rows) {
        const map = allMapMetadata.get(mapname);
        if (!map) continue;
        const row = byTier.get(map.tier) ?? { tier: map.tier, linear: 0, staged: 0 };
        if (isStagedMap(map)) row.staged++;
        else row.linear++;
        byTier.set(map.tier, row);
      }
      return [...byTier.values()].sort((a, b) => a.tier - b.tier);
    },
  });
}

