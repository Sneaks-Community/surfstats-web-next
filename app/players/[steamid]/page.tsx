import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import Link from 'next/link';
import { getSteamAvatars, getSteamProfileUrl } from '@/lib/steam';
import { Trophy, Activity, Clock } from 'lucide-react';
import Image from 'next/image';
import { unstable_cache } from 'next/cache';
import { formatPlaytime, formatDate } from '@/lib/utils';
import { sanitizeSteamId, sanitizePlayerName } from '@/lib/sanitize';
import CountryBadge from '@/components/CountryBadge';
import { countryNameToCode } from '@/lib/countries';
import { getTotalsCached } from '@/lib/cache';
import { getPlayerTimeOnServer, getPerformanceTrend } from '@/lib/player-analytics';
import { getAllMapMetadata, getTierDistributionWithStages } from '@/lib/map-cache';
import {
  getIncompleteMapsForPlayer,
  getIncompleteBonusesForPlayer,
  getIncompleteStagesForPlayer
} from '@/lib/registry-cache';
import logger from '@/lib/logger';
import type { Metadata } from 'next';
import TierDistributionChart from './components/TierDistributionChart';
import PerformanceTrendChart from './components/PerformanceTrendChart';
import PlayerRecordsTabs from './components/PlayerRecordsTabs';
import ProgressBar from '@/components/ProgressBar';

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
 */
const getLinearVsStagedPerTier = unstable_cache(
  async (steamid: string): Promise<{ tier: number; linear: number; staged: number }[]> => {
    logger.debug(`[Player] Fetching linear vs staged per tier for: ${steamid}`);
    
    try {
      // Get completed map names for this player
      const [finishedMapsResult] = await pool.query<RowDataPacket[]>(
        'SELECT DISTINCT mapname FROM ck_playertimes WHERE steamid = ?',
        [steamid]
      );
      
      const finishedMapnames = new Set(finishedMapsResult.map(r => r.mapname));
      
      // Get all map metadata to determine which maps have stages
      const allMapMetadata = await getAllMapMetadata();
      
      // Initialize all tiers 1-10 as array (not Map, for JSON serialization)
      const distribution: { tier: number; linear: number; staged: number }[] = [];
      for (let tier = 1; tier <= 10; tier++) {
        distribution.push({ tier, linear: 0, staged: 0 });
      }
      
      // Count player's completed maps per tier, split by linear vs staged
      for (const [mapname, metadata] of allMapMetadata) {
        const tier = metadata.tier;
        const stages = metadata.stages || 0;
        
        if (!finishedMapnames.has(mapname)) {
          // Player hasn't completed this map
          continue;
        }
        
        // Find the tier entry in the array
        const tierEntry = distribution.find(d => d.tier === tier);
        if (tierEntry) {
          if (stages === 0) {
            // Linear map (no stages)
            tierEntry.linear++;
          } else {
            // Staged map (has stages)
            tierEntry.staged++;
          }
        }
      }
      
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
  ['player-linear-vs-staged-per-tier'],
  { revalidate: 60 }
);

const getPlayerData = unstable_cache(
  async (steamid: string) => {
    logger.debug(`[Player] Fetching profile data for: ${steamid}`);
    
    try {
      // Get basic player info and rank
      const [playerRows] = await pool.query<PlayerData[]>(`
        SELECT
          steamid, name, country, points, lastseen,
          (SELECT COUNT(*) + 1 FROM ck_playerrank pr2 WHERE pr2.points > pr1.points) as rank
        FROM ck_playerrank pr1
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

const getIncompleteRecords = unstable_cache(
  async (steamid: string) => {
    logger.debug(`[Player] Fetching incomplete records for: ${steamid}`);
    
    try {
      // Use cached map metadata and registry data instead of full table scans
      // This is much more efficient than querying all maps/bonuses/stages from database
      const [allMapMetadata, finishedMapsResult, finishedBonusesResult, finishedStagesResult] = await Promise.all([
        getAllMapMetadata(),
        pool.query<RowDataPacket[]>('SELECT DISTINCT mapname FROM ck_playertimes WHERE steamid = ?', [steamid]),
        pool.query<RowDataPacket[]>('SELECT DISTINCT mapname, zonegroup FROM ck_bonus WHERE steamid = ?', [steamid]),
        pool.query<RowDataPacket[]>('SELECT DISTINCT map, stage FROM ck_stages WHERE steamid = ?', [steamid]),
      ]);
      
      // Get finished map names for this player
      const finishedMapnames = new Set(finishedMapsResult[0].map(r => r.mapname));
      
      // Build incomplete maps list from cached metadata
      const incompleteMaps: IncompleteMapRecord[] = [];
      for (const [mapname, metadata] of allMapMetadata) {
        if (!finishedMapnames.has(mapname)) {
          incompleteMaps.push({
            mapname,
            tier: metadata.tier,
            wr_time: metadata.wr_time,
          });
        }
      }
      // Sort by tier then name (handle null tiers)
      incompleteMaps.sort((a, b) => {
        const aTier = a.tier ?? 0;
        const bTier = b.tier ?? 0;
        if (aTier !== bTier) return aTier - bTier;
        return a.mapname.localeCompare(b.mapname);
      });
      
      // Get finished bonus groups for this player
      const finishedBonusSet = new Set(
        finishedBonusesResult[0].map(r => `${r.mapname}:${r.zonegroup}`)
      );
      
      // Get incomplete bonuses using cached registry
      const incompleteBonusesList: IncompleteBonusRecord[] = [];
      const allBonusGroups = await getIncompleteBonusesForPlayer(finishedBonusSet);
      for (const bonus of allBonusGroups) {
        incompleteBonusesList.push({
          mapname: bonus.mapname,
          zonegroup: bonus.zonegroup,
          wr_time: bonus.wr_time,
        });
      }
      
      // Get finished stages for this player
      const finishedStageSet = new Set(
        finishedStagesResult[0].map(r => `${r.map}:${r.stage}`)
      );
      
      // Get incomplete stages using cached registry
      const incompleteStagesList: IncompleteStageRecord[] = [];
      const allStages = await getIncompleteStagesForPlayer(finishedStageSet);
      for (const stage of allStages) {
        incompleteStagesList.push({
          map: stage.map,
          stage: stage.stage,
        });
      }

      logger.debug(`[Player] Incomplete records for ${steamid}: ${incompleteMaps.length} maps, ${incompleteBonusesList.length} bonuses, ${incompleteStagesList.length} stages`);

      return { incompleteMaps, incompleteBonuses: incompleteBonusesList, incompleteStages: incompleteStagesList };
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
    const [playerRows] = await pool.query<PlayerData[]>(
      'SELECT name FROM ck_playerrank WHERE steamid = ?',
      [validSteamId]
    );

    if (playerRows.length === 0) {
      return {
        title: 'Player Not Found',
      };
    }

    const player = playerRows[0];
    return {
      title: `${sanitizePlayerName(player.name)} - Player Profile`,
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
  const decodedSteamId = decodeURIComponent(steamid);
  
  // Validate and sanitize SteamID input
  const validSteamId = sanitizeSteamId(decodedSteamId);
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
  
  // Fetch performance trend data
  const performanceTrendRaw = await getPerformanceTrend(validSteamId);
  // Ensure performanceTrend is always an array for client-side serialization
  const performanceTrend: { date: string; avgTime: number; mapCount: number; tier: number }[] = 
    performanceTrendRaw || [];

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
                <span className="font-mono bg-surface-hover px-2 py-1 rounded text-text">{player.steamid}</span>
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
              <div className="bg-surface border border-border rounded-xl p-3 flex flex-col items-center justify-center md:col-start-4 md:col-span-1">
                <Clock className="w-8 h-8 text-purple-500 mb-2" />
                <span className="text-2xl font-bold text-text">{formatPlaytime(playtimeData.totalSeconds)}</span>
                <span className="text-xs text-text-muted">Time on Server</span>
              </div>
            ) : null}
            {/* Progress Bars - Stacked vertically in a single container to the right of Time on Server */}
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
        {/* Performance Trend - stacked on mobile/tablet, 3 columns on desktop */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:col-span-3">
          <div className="lg:col-span-1 h-[280px] min-h-[280px]">
            {performanceTrend && performanceTrend.length > 0 ? (
              <PerformanceTrendChart data={performanceTrend} />
            ) : (
              <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
                <h3 className="text-sm font-semibold text-text mb-2">Performance Trend</h3>
                <div className="flex-1 min-h-[200px] flex items-center justify-center text-text-muted text-sm">
                  No completion history
                </div>
              </div>
            )}
          </div>
          {/* Placeholder for additional charts */}
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
