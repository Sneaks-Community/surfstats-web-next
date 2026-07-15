import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import Link from 'next/link';
import { getSteamProfilesFromCache } from '@/lib/steam';
import { validateSteamId } from '@/lib/validators';
import { getTotalsFromCache } from '@/lib/cache';
import { getPlayerTimeOnServerFromCache, getActivityHeatmapFromCache } from '@/lib/player-analytics';
import { getTierDistributionFromCache } from '@/lib/valkey-map-cache';
import { getPlayerNameFromCache } from '@/lib/player-cache';
import { getPlayerProfileFromCache } from '@/lib/player-profile-cache';
import logger from '@/lib/logger';
import PlayerProfileContent from './components/PlayerProfileContent';
import { getErrorMessage } from '@/lib/errors';


/**
 * Get player profile data with caching
 * Uses the new player profile cache for improved performance
 */
async function getPlayerData(steamid: string) {
  logger.debug(`[Player] Fetching profile data for: ${steamid}`);
  
  try {
    // Get player name from cached function (Next.js will deduplicate with generateMetadata)
    const { name } = await getPlayerNameFromCache(steamid);
    
    if (!name) {
      logger.warn(`[Player] No player found with SteamID: ${steamid}`);
      return null;
    }

    // Use cached player profile function
    const cachedProfile = await getPlayerProfileFromCache(steamid);
    
    if (cachedProfile) {
      logger.debug(`[Player] Profile loaded from cache for ${cachedProfile.player.name} (${steamid}): ${cachedProfile.maps.length} maps, ${cachedProfile.bonuses.length} bonuses, ${cachedProfile.stages.length} stages`);
      return cachedProfile;
    }

    // Fallback to direct database query if cache miss and internal fetch failed
    logger.warn(`[Player] Profile cache miss and internal fetch failed for ${steamid}, returning null`);
    return null;
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    const errorMessage = getErrorMessage(error);
    logger.error(`[Player] Failed to fetch profile for ${steamid}: ${errorMessage}`);
    logger.error(`[Player] Error code: ${err.code || 'N/A'}`);
    return null;
  }
}

async function getIncompleteRecords(steamid: string) {
  logger.debug(`[Player] Fetching incomplete records for: ${steamid}`);
  
  try {
    const { getAllMapMetadataFromCache } = await import('@/lib/valkey-map-cache');
    
    // Fetch all incomplete records in parallel using optimized anti-join queries
    const [incompleteMaps, incompleteBonuses, incompleteStages] = await Promise.all([
      // Incomplete maps
      (async () => {
        const [rows] = await pool.query<RowDataPacket[]>(`
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
        `, [steamid]);
        
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
      })(),
      // Incomplete bonuses
      (async () => {
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
        `, [steamid]);
        
        return rows.map(r => ({
          mapname: r.mapname,
          zonegroup: r.zonegroup,
          wr_time: r.wr_time,
        }));
      })(),
      // Incomplete stages
      (async () => {
        const [rows] = await pool.query<RowDataPacket[]>(`
          SELECT
            z.mapname as map,
            z.zonetypeid as stage
          FROM ck_zones z
          LEFT JOIN ck_stages sr ON z.mapname = sr.map AND z.zonetypeid = sr.stage AND sr.steamid = ?
          WHERE z.zonetype = 3 AND z.zonegroup = 0 AND z.zonetypeid > 0 AND sr.map IS NULL
          ORDER BY z.mapname ASC, z.zonetypeid ASC
        `, [steamid]);
        
        return rows.map(r => ({
          map: r.map,
          stage: r.stage,
        }));
      })(),
    ]);

    logger.debug(`[Player] Incomplete records for ${steamid}: ${incompleteMaps.length} maps, ${incompleteBonuses.length} bonuses, ${incompleteStages.length} stages`);

    return { incompleteMaps, incompleteBonuses, incompleteStages };
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    const errorMessage = getErrorMessage(error);
    logger.error(`[Player] Failed to fetch incomplete records for ${steamid}: ${errorMessage}`);
    logger.error(`[Player] Error code: ${err.code || 'N/A'}`);
    return { incompleteMaps: [], incompleteBonuses: [], incompleteStages: [] };
  }
}

interface TierDistributionRow { tier: number; linear: number; staged: number }

/**
 * Fetch the player's linear/staged completion counts per tier, returning only
 * the tiers the player has actually completed (no padding). Zero-filling across
 * the server's full tier range is applied separately by `padTierDistribution`,
 * which is driven by the server's real tier ceiling rather than a hardcoded max.
 */
async function getLinearVsStagedPerTier(steamid: string): Promise<TierDistributionRow[]> {
  logger.debug(`[Player] Fetching linear vs staged per tier for: ${steamid}`);

  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
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
    `, [steamid]);

    logger.debug(`[Player] Raw query results for ${steamid}: ${JSON.stringify(rows)}`);

    // MySQL returns numbers as strings, so convert them here.
    return rows.map(row => ({
      tier: Number(row.tier),
      linear: Number(row.linear) || 0,
      staged: Number(row.staged) || 0,
    }));
  } catch (error: unknown) {
    logger.error(`[Player] Failed to fetch linear vs staged per tier: ${getErrorMessage(error)}`);
    return [];
  }
}

/**
 * Zero-fill the player's per-tier completions across the full tier range
 * `1..maxTier`, so the radar chart shows every tier the server supports (with
 * un-completed tiers at zero) and never silently drops a tier. `maxTier` comes
 * from the server's actual map pool, so a server with tiers up to 6 renders
 * 1-6 and a server with tiers up to 10 renders 1-10 — no blank trailing axes.
 *
 * When the player has no completions at all, returns an empty array so the
 * chart renders its "No completions" empty state instead of an all-zero radar.
 */
function padTierDistribution(rows: TierDistributionRow[], maxTier: number): TierDistributionRow[] {
  if (rows.length === 0) return [];

  const byTier = new Map(rows.map(r => [r.tier, r]));
  const distribution: TierDistributionRow[] = [];
  for (let tier = 1; tier <= maxTier; tier++) {
    distribution.push(byTier.get(tier) ?? { tier, linear: 0, staged: 0 });
  }
  return distribution;
}

export async function generateMetadata({ params }: { params: Promise<{ steamid: string }> }) {
  const { steamid } = await params;
  const decodedSteamId = decodeURIComponent(steamid);
  const validSteamId = validateSteamId(decodedSteamId);
  
  if (!validSteamId) {
    return {
      title: 'Invalid SteamID',
    };
  }

  try {
    const { name } = await getPlayerNameFromCache(validSteamId);

    if (!name) {
      return {
        title: 'Player Not Found',
      };
    }

    return {
      title: `${name} - Player Profile`,
    };
  } catch (error: unknown) {
    logger.error(`[Player] Failed to generate metadata for ${validSteamId}: ${getErrorMessage(error)}`);
    return {
      title: 'Player Profile',
    };
  }
}

export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ steamid: string }>;
}) {
  const { steamid } = await params;
  const decodedSteamId: string = decodeURIComponent(steamid);
  
  // Validate and sanitize SteamID input
  const validSteamId = validateSteamId(decodedSteamId) ?? decodedSteamId;
  if (!validSteamId) {
    return (
      <div className="text-center py-20 bg-surface border border-border rounded-xl">
        <h1 className="text-2xl font-bold text-text mb-2">Invalid SteamID</h1>
        <p className="text-text-muted">The provided SteamID format is invalid.</p>
        <Link href="/players" className="inline-block mt-6 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-md transition-colors">
          Back to Players
        </Link>
      </div>
    );
  }
  
  // Group 1: Player data (required for early exit if not found)
  const data = await getPlayerData(validSteamId);
  
  if (!data) {
    return (
      <div className="text-center py-20 bg-surface border border-border rounded-xl">
        <h1 className="text-2xl font-bold text-text mb-2">Player Not Found</h1>
        <p className="text-text-muted">The player with SteamID {decodedSteamId} could not be found.</p>
        <Link href="/players" className="inline-block mt-6 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-md transition-colors">
          Back to Players
        </Link>
      </div>
    );
  }

  // Group 2: Parallel fetch for remaining data
  const [incompleteData, totals, steamAvatars, playtimeData, linearVsStagedRaw, activityHeatmap, tierDistribution] = await Promise.all([
    getIncompleteRecords(validSteamId),
    getTotalsFromCache(),
    getSteamProfilesFromCache([decodedSteamId]),
    getPlayerTimeOnServerFromCache(validSteamId),
    getLinearVsStagedPerTier(validSteamId),
    getActivityHeatmapFromCache(validSteamId),
    getTierDistributionFromCache(),
  ]);

  // The tier ceiling is a property of the server's map pool, not the player.
  // Derive it from the server-wide tier distribution so the chart shows exactly
  // the tiers this server supports. Fall back to the player's own highest
  // completed tier as a floor, so a stale distribution cache can never drop a
  // tier the player has actually completed.
  const maxTier = Math.max(
    1,
    ...tierDistribution.keys(),
    ...linearVsStagedRaw.map(r => r.tier),
  );
  const linearVsStagedPerTier = padTierDistribution(linearVsStagedRaw, maxTier);

  // Compute WR performance data from maps
  const wrPerformanceData = (data.maps as Array<{
    mapname: string;
    runtimepro: number;
    date: string;
    tier: number;
    wr_time: number | null;
    player_rank: number;
  }>)
    .filter(m => m.wr_time != null && m.runtimepro > 0)
    .map(m => ({
      mapname: m.mapname,
      wrPercentage: ((m.wr_time ?? 0) / m.runtimepro) * 100,
      tier: m.tier,
      date: m.date,
    }));

  return (
    <div className="space-y-4">
      <PlayerProfileContent
        data={data}
        incompleteData={incompleteData}
        totals={totals}
        steamAvatars={steamAvatars}
        playtimeData={playtimeData}
        linearVsStagedPerTier={linearVsStagedPerTier}
        wrPerformanceData={wrPerformanceData}
        activityHeatmap={activityHeatmap}
        steamid={validSteamId}
      />
    </div>
  );
}
