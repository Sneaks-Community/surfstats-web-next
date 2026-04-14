import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import Link from 'next/link';
import { getSteamAvatars, getSteamProfileUrl } from '@/lib/steam';
import { unstable_cache } from 'next/cache';
import { sanitizeSteamId } from '@/lib/sanitize';
import { getTotalsCached } from '@/lib/cache';
import { getPlayerTimeOnServer } from '@/lib/player-analytics';
import { getPlayerName } from '@/lib/player-cache';
import logger from '@/lib/logger';
import PlayerProfileContent from './components/PlayerProfileContent';


const getPlayerData = unstable_cache(
  async (steamid: string) => {
    logger.debug(`[Player] Fetching profile data for: ${steamid}`);
    
    try {
      // Get player name from cached function (Next.js will deduplicate with generateMetadata)
      const { name } = await getPlayerName(steamid);
      
      if (!name) {
        logger.warn(`[Player] No player found with SteamID: ${steamid}`);
        return null;
      }

      // Get basic player info and rank (excluding name since we already have it)
      // Optimized with window function instead of correlated subquery
      const [playerRows] = await pool.query<RowDataPacket[]>(`
        SELECT
          steamid, name, country, points, lastseen,
          DENSE_RANK() OVER (ORDER BY points DESC) as rank
        FROM ck_playerrank
        WHERE steamid = ?
      `, [steamid]);

      if (playerRows.length === 0) {
        logger.warn(`[Player] No player found with SteamID: ${steamid}`);
        return null;
      }
      const player = playerRows[0];

      // Fetch all map metadata from cache once (reuses existing cache)
      const { getAllMapMetadata } = await import('@/lib/map-cache');
      const allMapMetadata = await getAllMapMetadata();

      // PARALLEL: Fetch maps, bonuses, and stages simultaneously
      // Maps include WR time for comparison and player rank (optimized with count-based rank)
      // Tier is looked up from cache instead of joining ck_maptier
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

      logger.debug(`[Player] Profile loaded for ${player.name} (${steamid}): ${maps.length} maps, ${bonuses.length} bonuses, ${stages.length} stages`);
      
      return { player, maps, bonuses, stages };
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      logger.error(`[Player] Failed to fetch profile for ${steamid}: ${errorMessage}`);
      logger.error(`[Player] Error code: ${error.code || 'N/A'}`);
      return null;
    }
  },
  ['player-profile'],
  { revalidate: 60 }
);

const getIncompleteRecords = unstable_cache(
  async (steamid: string) => {
    logger.debug(`[Player] Fetching incomplete records for: ${steamid}`);
    
    try {
      const { getAllMapMetadata } = await import('@/lib/map-cache');
      
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
          
          const allMapMetadata = await getAllMapMetadata();
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
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      logger.error(`[Player] Failed to fetch incomplete records for ${steamid}: ${errorMessage}`);
      logger.error(`[Player] Error code: ${error.code || 'N/A'}`);
      return { incompleteMaps: [], incompleteBonuses: [], incompleteStages: [] };
    }
  },
  ['player-incomplete-records'],
  { revalidate: 60 }
);

const getLinearVsStagedPerTier = unstable_cache(
  async (steamid: string): Promise<{ tier: number; linear: number; staged: number }[]> => {
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
    } catch (error: any) {
      logger.error(`[Player] Failed to fetch linear vs staged per tier: ${error.message}`);
      // Return empty array with all tiers at 0
      const emptyArray: { tier: number; linear: number; staged: number }[] = [];
      for (let tier = 1; tier <= 10; tier++) {
        emptyArray.push({ tier, linear: 0, staged: 0 });
      }
      return emptyArray;
    }
  },
  ['player-linear-vs-staged-per-tier-v2'],
  { revalidate: 60 }
);

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
    const { name } = await getPlayerName(validSteamId);

    if (!name) {
      return {
        title: 'Player Not Found',
      };
    }

    return {
      title: `${name} - Player Profile`,
    };
  } catch (error: any) {
    logger.error(`[Player] Failed to generate metadata for ${validSteamId}: ${error.message}`);
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

  const { player, maps, bonuses, stages } = data;
  
  // Group 2: Parallel fetch for remaining data
  const [incompleteData, totals, steamAvatars, playtimeData, linearVsStagedPerTier] = await Promise.all([
    getIncompleteRecords(validSteamId),
    getTotalsCached(),
    getSteamAvatars(decodedSteamId),
    getPlayerTimeOnServer(validSteamId),
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
