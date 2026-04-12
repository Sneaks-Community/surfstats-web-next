import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import Link from 'next/link';
import { getSteamAvatars, getSteamProfileUrl } from '@/lib/steam';
import { Trophy, Activity, Clock } from 'lucide-react';
import Image from 'next/image';
import { unstable_cache } from 'next/cache';
import { formatDate } from '@/lib/utils';
import { sanitizeSteamId, sanitizePlayerName } from '@/lib/sanitize';
import CountryBadge from '@/components/CountryBadge';
import { countryNameToCode } from '@/lib/countries';
import { getTotalsCached } from '@/lib/cache';
import { getPlayerTimeOnServer } from '@/lib/player-analytics';
import { getPlayerName } from '@/lib/player-cache';
import logger from '@/lib/logger';
import { getAllMapMetadata } from '@/lib/map-cache';
import TierDistributionChart from './components/TierDistributionChart';
import PlayerRecordsTabs from './components/PlayerRecordsTabs';
import ProgressBar from '@/components/ProgressBar';
import PlayerTimeDisplay from './components/PlayerTimeDisplay';

// Clear old cache entries to force re-execution of unstable_cache functions
// This is needed when the function body changes but the cache key stays the same
if (typeof globalThis !== 'undefined') {
  // @ts-ignore - clearing Next.js unstable_cache entries
  delete (globalThis as any)['player-linear-vs-staged-per-tier'];
  // @ts-ignore
  delete (globalThis as any)['player-incomplete-records'];
  // @ts-ignore
  delete (globalThis as any)['player-incomplete-maps'];
  // @ts-ignore
  delete (globalThis as any)['player-incomplete-bonuses'];
  // @ts-ignore
  delete (globalThis as any)['player-incomplete-stages'];
}

interface PlayerData extends RowDataPacket {
  steamid: string;
  name: string;
  country: string;
  points: number;
  lastseen: string;
  rank: number;
}

interface MapRecord extends RowDataPacket {
  mapname: string;
  runtimepro: number;
  date: string;
  wr_time: number | null;
  player_rank: number;
  tier: number;
}

interface IncompleteMapRecord {
  mapname: string;
  tier: number | null;
  wr_time: number | null;
  mapType: 'linear' | 'staged';
}

interface BonusRecord extends RowDataPacket {
  mapname: string;
  zonegroup: number;
  runtime: number;
  date: string;
  player_rank: number;
}

interface IncompleteBonusRecord {
  mapname: string;
  zonegroup: number;
  wr_time: number | null;
}

interface StageRecord extends RowDataPacket {
  map: string;
  stage: number;
  runtime: number;
  date: string;
  player_rank: number;
}

interface IncompleteStageRecord {
  map: string;
  stage: number;
}

/**
 * Get linear vs staged map completions per tier for the player
 * Uses database-level aggregation instead of client-side iteration
 * A map is considered "staged" if it has zones with zonetype=3, otherwise "linear"
 */
const getLinearVsStagedPerTier = unstable_cache(
  async (steamid: string): Promise<{ tier: number; linear: number; staged: number }[]> => {
    logger.debug(`[Player] Fetching linear vs staged per tier for: ${steamid}`);
    
    try {
      // Use database-level aggregation with conditional counting
      // A map is staged if it has zones with zonetype=3, otherwise linear
      // Note: 'linear' and 'staged' are quoted with backticks as they can be reserved words
      // Using COALESCE to ensure we get 0 instead of NULL when there are no rows
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
      const [playerRows] = await pool.query<PlayerData[]>(`
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

      // PARALLEL: Fetch maps, bonuses, and stages simultaneously
      // Maps include WR time for comparison and player rank (optimized with count-based rank)
      const [mapsResult, bonusesResult, stagesResult] = await Promise.all([
        pool.query<MapRecord[]>(`
          SELECT
            pt.mapname,
            pt.runtimepro,
            pt.date,
            wr.min_runtime as wr_time,
            (SELECT COUNT(*) + 1 FROM ck_playertimes pt2
             WHERE pt2.mapname = pt.mapname AND pt2.runtimepro < pt.runtimepro) as player_rank,
            COALESCE(mt.tier, 1) as tier
          FROM ck_playertimes pt
          LEFT JOIN (
            SELECT mapname, MIN(runtimepro) as min_runtime
            FROM ck_playertimes
            GROUP BY mapname
          ) wr ON pt.mapname = wr.mapname
          LEFT JOIN ck_maptier mt ON pt.mapname = mt.mapname
          WHERE pt.steamid = ?
          ORDER BY pt.mapname ASC
        `, [steamid]),
        pool.query<BonusRecord[]>(`
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
        pool.query<StageRecord[]>(`
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

const getIncompleteMaps = unstable_cache(
  async (steamid: string): Promise<IncompleteMapRecord[]> => {
    logger.debug(`[Player] Fetching incomplete maps for: ${steamid}`);
    
    try {
      // Use LEFT JOIN anti-join pattern to find maps player has NOT completed
      // Pre-compute WR times in a subquery to avoid correlated subquery
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
      
      // Fetch all map metadata from cache to determine map type
      const allMapMetadata = await getAllMapMetadata();
      
      // Map RowDataPacket to IncompleteMapRecord with mapType
      const incompleteMaps: IncompleteMapRecord[] = rows.map(r => {
        const mapMetadata = allMapMetadata.get(r.mapname);
        const mapType: 'linear' | 'staged' = mapMetadata && mapMetadata.stages > 1 ? 'staged' : 'linear';
        
        return {
          mapname: r.mapname,
          tier: r.tier,
          wr_time: r.wr_time,
          mapType,
        };
      });
      
      logger.debug(`[Player] Found ${incompleteMaps.length} incomplete maps for ${steamid}`);
      return incompleteMaps;
    } catch (error: any) {
      logger.error(`[Player] Failed to fetch incomplete maps: ${error.message}`);
      return [];
    }
  },
  ['player-incomplete-maps'],
  { revalidate: 60 }
);

const getIncompleteBonuses = unstable_cache(
  async (steamid: string): Promise<IncompleteBonusRecord[]> => {
    logger.debug(`[Player] Fetching incomplete bonuses for: ${steamid}`);
    
    try {
      // Use LEFT JOIN anti-join pattern to find bonuses player has NOT completed
      // Pre-compute WR times in a subquery to avoid correlated subquery
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT
          z.mapname,
          z.zonegroup,
          wr.min_runtime as wr_time
        FROM ck_zones z
        INNER JOIN ck_maptier m ON z.mapname = m.mapname
        LEFT JOIN ck_bonus br ON z.mapname = br.mapname AND z.zonegroup = br.zonegroup AND br.steamid = ?
        LEFT JOIN (
          SELECT mapname, zonegroup, MIN(runtime) as min_runtime
          FROM ck_bonus
          GROUP BY mapname, zonegroup
        ) wr ON z.mapname = wr.mapname AND z.zonegroup = wr.zonegroup
        WHERE z.zonetype = 2 AND z.zonegroup > 0 AND br.mapname IS NULL
        ORDER BY m.tier ASC, z.mapname ASC, z.zonegroup ASC
      `, [steamid]);
      
      // Map RowDataPacket to IncompleteBonusRecord
      const incompleteBonuses: IncompleteBonusRecord[] = rows.map(r => ({
        mapname: r.mapname,
        zonegroup: r.zonegroup,
        wr_time: r.wr_time,
      }));
      
      logger.debug(`[Player] Found ${incompleteBonuses.length} incomplete bonuses for ${steamid}`);
      return incompleteBonuses;
    } catch (error: any) {
      logger.error(`[Player] Failed to fetch incomplete bonuses: ${error.message}`);
      return [];
    }
  },
  ['player-incomplete-bonuses'],
  { revalidate: 60 }
);

const getIncompleteStages = unstable_cache(
  async (steamid: string): Promise<IncompleteStageRecord[]> => {
    logger.debug(`[Player] Fetching incomplete stages for: ${steamid}`);
    
    try {
      // Use LEFT JOIN anti-join pattern to find stages player has NOT completed
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT
          z.mapname as map,
          z.zonetypeid as stage
        FROM ck_zones z
        INNER JOIN ck_maptier m ON z.mapname = m.mapname
        LEFT JOIN ck_stages sr ON z.mapname = sr.map AND z.zonetypeid = sr.stage AND sr.steamid = ?
        WHERE z.zonetype = 3 AND z.zonegroup = 0 AND z.zonetypeid > 0 AND sr.map IS NULL
        ORDER BY m.tier ASC, z.mapname ASC, z.zonetypeid ASC
      `, [steamid]);
      
      const incompleteStages: IncompleteStageRecord[] = rows.map(r => ({
        map: r.map,
        stage: r.stage,
      }));
      
      logger.debug(`[Player] Found ${incompleteStages.length} incomplete stages for ${steamid}`);
      return incompleteStages;
    } catch (error: any) {
      logger.error(`[Player] Failed to fetch incomplete stages: ${error.message}`);
      return [];
    }
  },
  ['player-incomplete-stages'],
  { revalidate: 60 }
);

const getIncompleteRecords = unstable_cache(
  async (steamid: string) => {
    logger.debug(`[Player] Fetching incomplete records for: ${steamid}`);
    
    try {
      // Fetch all incomplete records in parallel using optimized anti-join queries
      const [incompleteMaps, incompleteBonuses, incompleteStages] = await Promise.all([
        getIncompleteMaps(steamid),
        getIncompleteBonuses(steamid),
        getIncompleteStages(steamid),
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
      title: `${sanitizePlayerName(name)} - Player Profile`,
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
  
  // Fetch incomplete records (maps, bonuses, stages not completed by this player)
  const incompleteData = await getIncompleteRecords(validSteamId);
  
  const totals = await getTotalsCached();
  const steamAvatars = await getSteamAvatars(decodedSteamId);
  
  // Fetch playtime from analytics database (optional, box hidden if unavailable)
  const playtimeData = await getPlayerTimeOnServer(validSteamId);
  
  // Fetch linear vs staged per tier for radar chart (returns array directly)
  const linearVsStagedPerTier = await getLinearVsStagedPerTier(validSteamId);

  return (
    <div className="space-y-4">
      {/* Profile Header */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-primary-900 to-background-secondary"></div>
        <div className="px-4 sm:px-6 pb-4 relative">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end -mt-8 sm:-mt-10 mb-4">
            {(() => {
              const profileUrl = getSteamProfileUrl(decodedSteamId);
              return profileUrl ? (
                <a
                  href={profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative h-16 w-16 sm:h-24 sm:w-24 rounded-xl overflow-hidden border-4 border-surface flex-shrink-0"
                >
                  {steamAvatars?.avatarfull ? (
                    <Image
                      src={steamAvatars.avatarfull}
                      alt={player.name}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-surface-hover">
                      <span className="text-4xl font-bold text-text-placeholder">{sanitizePlayerName(player.name).charAt(0).toUpperCase()}</span>
                    </div>
                  )}
                </a>
              ) : (
                <div className="relative h-16 w-16 sm:h-24 sm:w-24 rounded-xl overflow-hidden border-4 border-surface bg-surface-hover flex-shrink-0">
                  {steamAvatars?.avatarfull ? (
                    <Image
                      src={steamAvatars.avatarfull}
                      alt={player.name}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-surface-hover">
                      <span className="text-4xl font-bold text-text-placeholder">{sanitizePlayerName(player.name).charAt(0).toUpperCase()}</span>
                    </div>
                  )}
                </div>
              );
            })()}
            <div className="flex-1 pb-2">
              <h1 className="text-3xl font-bold text-text">{sanitizePlayerName(player.name)}</h1>
              <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-text-muted">
                {(() => {
                  const profileUrl = getSteamProfileUrl(decodedSteamId);
                  if (!profileUrl) {
                    return (
                      <span className="font-mono bg-surface-hover px-2 py-1 rounded text-text">
                        {player.steamid}
                      </span>
                    );
                  }
                  return (
                    <a
                      href={profileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono bg-surface-hover px-2 py-1 rounded text-text hover:opacity-80 transition-opacity"
                    >
                      {player.steamid}
                    </a>
                  );
                })()}
                {player.country && (
                  (() => {
                    const countryCode = countryNameToCode[player.country.toLowerCase()];
                    if (!countryCode) return null;
                    return (
                      <Link
                        href={`/players/countries/${countryCode}`}
                        className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                      >
                        <CountryBadge countryCode={player.country} showName={false} />
                        <span>{player.country}</span>
                      </Link>
                    );
                  })()
                )}
                <span>Last Seen: {player.lastseen ? formatDate(player.lastseen) : 'Unknown'}</span>
              </div>
            </div>
          </div>
          
          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-[1fr_1fr_1fr_1fr_2fr] gap-2">
            <div className="bg-surface border border-border rounded-xl p-3 flex flex-col items-center justify-center">
              <Trophy className="w-8 h-8 text-yellow-500 mb-2" />
              <span className="text-2xl font-bold text-text">#{player.rank}</span>
              <span className="text-xs text-text-muted">Global Rank</span>
            </div>
            <div className="bg-surface border border-border rounded-xl p-3 flex flex-col items-center justify-center">
              <Activity className="w-8 h-8 text-blue-500 mb-2" />
              <span className="text-2xl font-bold text-text">{maps.length.toLocaleString()}</span>
              <span className="text-xs text-text-muted">Maps Completed</span>
            </div>
            <div className="bg-surface border border-border rounded-xl p-3 flex flex-col items-center justify-center">
              <Clock className="w-8 h-8 text-green-500 mb-2" />
              <span className="text-2xl font-bold text-text">{player.points.toLocaleString()}</span>
              <span className="text-xs text-text-muted">Points</span>
            </div>
            {playtimeData && playtimeData.totalSeconds > 0 ? (
              <PlayerTimeDisplay totalSeconds={playtimeData.totalSeconds} />
            ) : null}
            {/* Progress Bars - Stacked vertically in a single container to the right of Time Played */}
            <div className="bg-surface border border-border rounded-xl p-3 col-span-2 md:col-start-5 md:row-start-1 flex flex-col justify-center space-y-3">
              <ProgressBar label="Map" current={maps.length} total={totals.totalMaps} color="blue" />
              <ProgressBar label="Bonus" current={bonuses.length} total={totals.totalBonuses} color="purple" />
              <ProgressBar label="Stage" current={stages.length} total={totals.totalStages} color="orange" />
            </div>
          </div>
        </div>
      </div>

      {/* Stats Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        {/* Tier Distribution Radar - full width on mobile, 1st column on desktop */}
        <div className="lg:col-span-1 lg:row-span-1 h-[280px] min-h-[280px]">
          {linearVsStagedPerTier && linearVsStagedPerTier.length > 0 ? (
            <TierDistributionChart data={linearVsStagedPerTier} />
          ) : (
            <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
              <h3 className="text-sm font-semibold text-text mb-2">Tier Distribution</h3>
              <div className="flex-1 min-h-[200px] flex items-center justify-center text-text-muted text-sm">
                No data available
              </div>
            </div>
          )}
        </div>
        {/* Placeholder for additional charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:col-span-3">
          <div className="bg-surface border border-border rounded-xl p-4 flex flex-col h-[130px] lg:h-auto">
            <h3 className="text-sm font-semibold text-text mb-2">Coming Soon</h3>
            <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
              Additional stats
            </div>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4 flex flex-col h-[130px] lg:h-auto">
            <h3 className="text-sm font-semibold text-text mb-2">Coming Soon</h3>
            <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
              Additional stats
            </div>
          </div>
        </div>
      </div>

      {/* Records Section - Tabbed Interface */}
      <PlayerRecordsTabs
        maps={maps}
        bonuses={bonuses}
        stages={stages}
        incompleteMaps={incompleteData.incompleteMaps}
        incompleteBonuses={incompleteData.incompleteBonuses}
        incompleteStages={incompleteData.incompleteStages}
        steamid={validSteamId}
      />
    </div>
  );
}
