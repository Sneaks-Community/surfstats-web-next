import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import Link from 'next/link';
import { getSteamProfilesFromCache } from '@/lib/steam';
import { sanitizeSteamId } from '@/lib/sanitize';
import { getTotalsFromCache } from '@/lib/cache';
import { getPlayerTimeOnServerFromCache } from '@/lib/player-analytics';
import { getPlayerNameFromCache } from '@/lib/player-cache';
import { getPlayerProfileFromCache } from '@/lib/player-profile-cache';
import logger from '@/lib/logger';
import PlayerProfileContent from './components/PlayerProfileContent';


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
    const errorMessage = err.message || 'Unknown error';
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
    const errorMessage = err.message || 'Unknown error';
    logger.error(`[Player] Failed to fetch incomplete records for ${steamid}: ${errorMessage}`);
    logger.error(`[Player] Error code: ${err.code || 'N/A'}`);
    return { incompleteMaps: [], incompleteBonuses: [], incompleteStages: [] };
  }
}

async function getLinearVsStagedPerTier(steamid: string): Promise<{ tier: number; linear: number; staged: number }[]> {
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
    
    // Initialize all tiers 1-10 with zeros
    const distribution: { tier: number; linear: number; staged: number }[] = [];
    for (let tier = 1; tier <= 10; tier++) {
      distribution.push({ tier, linear: 0, staged: 0 });
    }
    
    // Merge query results into the distribution array
    for (const row of rows) {
      const tier = Number(row.tier);
      const tierEntry = distribution.find(d => d.tier === tier);
      if (tierEntry) {
        // MySQL returns numbers as strings, so we need to convert them
        const linearVal = Number(row.linear) || 0;
        const stagedVal = Number(row.staged) || 0;
        tierEntry.linear = linearVal;
        tierEntry.staged = stagedVal;
        logger.debug(`[Player] Merged tier ${tier}: linear=${linearVal}, staged=${stagedVal}`);
      }
    }
    
    const totalLinear = distribution.reduce((sum, d) => sum + d.linear, 0);
    const totalStaged = distribution.reduce((sum, d) => sum + d.staged, 0);
    logger.debug(`[Player] Total for ${steamid}: linear=${totalLinear}, staged=${totalStaged}`);
    
    return distribution;
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error(`[Player] Failed to fetch linear vs staged per tier: ${err.message || 'Unknown error'}`);
    // Return empty array with all tiers at 0
    const emptyArray: { tier: number; linear: number; staged: number }[] = [];
    for (let tier = 1; tier <= 10; tier++) {
      emptyArray.push({ tier, linear: 0, staged: 0 });
    }
    return emptyArray;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ steamid: string }> }) {
  const { steamid } = await params;
  const decodedSteamId = decodeURIComponent(steamid);
  const validSteamId = sanitizeSteamId(decodedSteamId);
  
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
    const err = error as { message?: string };
    logger.error(`[Player] Failed to generate metadata for ${validSteamId}: ${err.message || 'Unknown error'}`);
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
  const validSteamId = sanitizeSteamId(decodedSteamId) ?? decodedSteamId;
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

  const { player: _player, maps: _maps, bonuses: _bonuses, stages: _stages } = data;
  
  // Group 2: Parallel fetch for remaining data
  const [incompleteData, totals, steamAvatars, playtimeData, linearVsStagedPerTier] = await Promise.all([
    getIncompleteRecords(validSteamId),
    getTotalsFromCache(),
    getSteamProfilesFromCache([decodedSteamId]),
    getPlayerTimeOnServerFromCache(validSteamId),
    getLinearVsStagedPerTier(validSteamId),
  ]);

  return (
    <div className="space-y-4">
      <PlayerProfileContent
        data={data}
        incompleteData={incompleteData}
        totals={totals}
        steamAvatars={steamAvatars}
        playtimeData={playtimeData}
        linearVsStagedPerTier={linearVsStagedPerTier}
        steamid={validSteamId}
      />
    </div>
  );
}
