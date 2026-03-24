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
import { getTotalsCached } from '@/lib/cache';
import { getPlayerTimeOnServer } from '@/lib/player-analytics';
import logger from '@/lib/logger';
import type { Metadata } from 'next';
import TierDistributionChart from './components/TierDistributionChart';
import PlayerRecordsTabs from './components/PlayerRecordsTabs';

interface PlayerData extends RowDataPacket {
  steamid: string;
  name: string;
  country: string;
  points: number;
  finishedmaps: number;
  lastseen: string;
  rank: number;
}

interface MapRecord extends RowDataPacket {
  mapname: string;
  runtimepro: number;
  date: string;
  wr_time: number | null;
  player_rank: number;
}

interface BonusRecord extends RowDataPacket {
  mapname: string;
  zonegroup: number;
  runtime: number;
  date: string;
  player_rank: number;
}

interface StageRecord extends RowDataPacket {
  map: string;
  stage: number;
  runtime: number;
  date: string;
  player_rank: number;
}

interface TierDistribution extends RowDataPacket {
  tier: number;
  completed_maps: number;
  total_maps: number;
}

const getTierDistribution = unstable_cache(
  async (steamid: string): Promise<TierDistribution[]> => {
    logger.debug(`[Player] Fetching tier distribution for: ${steamid}`);
    
    try {
      // Get completed maps per tier with total maps per tier
      const [rows] = await pool.query<TierDistribution[]>(`
        SELECT
          t.tier,
          COUNT(DISTINCT pt.mapname) as completed_maps,
          totals.total_maps
        FROM ck_maptier t
        CROSS JOIN (
          SELECT tier, COUNT(DISTINCT mapname) as total_maps
          FROM ck_maptier
          GROUP BY tier
        ) totals
        LEFT JOIN ck_playertimes pt
          ON t.mapname = pt.mapname
          AND pt.steamid = ?
        WHERE t.tier = totals.tier
        GROUP BY t.tier, totals.total_maps
        ORDER BY t.tier ASC
      `, [steamid]);
      
      return rows;
    } catch (error: any) {
      logger.error(`[Player] Failed to fetch tier distribution: ${error.message}`);
      return [];
    }
  },
  ['player-tier-distribution'],
  { revalidate: 60 }
);

const getPlayerData = unstable_cache(
  async (steamid: string) => {
    logger.debug(`[Player] Fetching profile data for: ${steamid}`);
    
    try {
      // Get basic player info and rank
      const [playerRows] = await pool.query<PlayerData[]>(`
        SELECT
          steamid, name, country, points, finishedmaps, lastseen,
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

export async function generateMetadata({ params }: { params: Promise<{ steamid: string }> }) {
  const { steamid } = await params;
  const decodedSteamId = decodeURIComponent(steamid);
  const validSteamId = sanitizeSteamId(decodedSteamId);
  
  if (!validSteamId) {
    return { title: 'Player Not Found' };
  }
  
  const data = await getPlayerData(validSteamId);
  
  if (!data) {
    return { title: 'Player Not Found' };
  }
  
  return {
    title: data.player.name,
  };
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
  const totals = await getTotalsCached();
  const steamAvatars = await getSteamAvatars(decodedSteamId);
  
  // Fetch playtime from analytics database (optional, box hidden if unavailable)
  const playtimeData = await getPlayerTimeOnServer(validSteamId);
  
  // Fetch tier distribution for chart
  const tierDistribution = await getTierDistribution(validSteamId);

  return (
    <div className="space-y-8">
      {/* Profile Header */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="h-32 bg-gradient-to-r from-primary-900 to-background-secondary"></div>
        <div className="px-6 sm:px-10 pb-8 relative">
          <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-end -mt-12 sm:-mt-16 mb-6">
            <div className="relative h-24 w-24 sm:h-32 sm:w-32 rounded-xl overflow-hidden border-4 border-surface bg-surface-hover flex-shrink-0">
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
            <div className="flex-1 pb-2">
              <h1 className="text-3xl font-bold text-text">{sanitizePlayerName(player.name)}</h1>
              <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-text-muted">
                <span className="font-mono bg-surface-hover px-2 py-1 rounded text-text">{player.steamid}</span>
                {player.country && (
                  <span className="flex items-center gap-2">
                    <CountryBadge countryCode={player.country} showName={false} />
                    <span>{player.country}</span>
                  </span>
                )}
                <span>Last seen: {player.lastseen ? formatDate(player.lastseen) : 'Unknown'}</span>
              </div>
            </div>
            <div className="pb-2 flex gap-3">
              {(() => {
                const profileUrl = getSteamProfileUrl(decodedSteamId);
                return profileUrl ? (
                  <a
                    href={profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-surface-hover hover:bg-surface-active text-text rounded-md font-medium transition-colors text-sm"
                  >
                    Steam Profile
                  </a>
                ) : null;
              })()}
            </div>
          </div>

          {/* Stats Row */}
          <div className="flex flex-wrap gap-3 justify-center items-center">
            <div className="bg-surface-hover/50 rounded-lg p-3 border border-border min-w-[100px] h-[72px] flex flex-col justify-center">
              <div className="flex items-center justify-center gap-1 text-text-muted mb-1">
                <Trophy className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                <span className="text-xs font-medium uppercase tracking-wider">Rank</span>
              </div>
              <div className="text-xl font-bold text-text text-center">#{player.rank}</div>
            </div>
            <div className="bg-surface-hover/50 rounded-lg p-3 border border-border min-w-[100px] h-[72px] flex flex-col justify-center">
              <div className="flex items-center justify-center gap-1 text-text-muted mb-1">
                <Activity className="h-4 w-4 text-primary flex-shrink-0" />
                <span className="text-xs font-medium uppercase tracking-wider">Points</span>
              </div>
              <div className="text-xl font-bold text-text text-center">{player.points.toLocaleString()}</div>
            </div>
            {playtimeData && (
              <div className="bg-surface-hover/50 rounded-lg p-3 border border-border min-w-[110px] h-[72px] flex flex-col justify-center">
                <div className="flex items-center justify-center gap-1 text-text-muted mb-1">
                  <Clock className="h-4 w-4 text-cyan-500 flex-shrink-0" />
                  <span className="text-xs font-medium uppercase tracking-wider">Time Played</span>
                </div>
                <div className="text-xl font-bold text-text text-center">
                  {formatPlaytime(playtimeData.totalSeconds)}
                </div>
              </div>
            )}
            {/* Progress bars stacked horizontally in a 72px tall container */}
            <div className="bg-surface-hover/50 rounded-lg p-2 border border-border h-[72px] flex flex-col justify-center gap-1.5 w-[240px]">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-blue-400 w-8 flex-shrink-0">Map</span>
                <div className="flex-1 h-3 bg-surface-active rounded overflow-hidden relative">
                  <div
                    className="h-full bg-blue-500 rounded animate-barber-pole"
                    style={{
                      width: `${totals.totalMaps > 0 ? Math.min(100, (maps.length / totals.totalMaps) * 100) : 0}%`,
                      backgroundImage: 'linear-gradient(45deg, rgba(255,255,255,0.15) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.15) 75%, transparent 75%, transparent)',
                      backgroundSize: '20px 20px',
                    }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white drop-shadow-md">
                    {totals.totalMaps > 0 ? Math.min(100, Math.round((maps.length / totals.totalMaps) * 100)) : 0}%
                  </span>
                </div>
                <span className="text-[10px] text-text w-12 text-right flex-shrink-0">{maps.length}/{totals.totalMaps}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-purple-400 w-8 flex-shrink-0">Bonus</span>
                <div className="flex-1 h-3 bg-surface-active rounded overflow-hidden relative">
                  <div
                    className="h-full bg-purple-500 rounded animate-barber-pole"
                    style={{
                      width: `${totals.totalBonuses > 0 ? Math.min(100, (bonuses.length / totals.totalBonuses) * 100) : 0}%`,
                      backgroundImage: 'linear-gradient(45deg, rgba(255,255,255,0.15) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.15) 75%, transparent 75%, transparent)',
                      backgroundSize: '20px 20px',
                    }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white drop-shadow-md">
                    {totals.totalBonuses > 0 ? Math.min(100, Math.round((bonuses.length / totals.totalBonuses) * 100)) : 0}%
                  </span>
                </div>
                <span className="text-[10px] text-text w-12 text-right flex-shrink-0">{bonuses.length}/{totals.totalBonuses}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-orange-400 w-8 flex-shrink-0">Stage</span>
                <div className="flex-1 h-3 bg-surface-active rounded overflow-hidden relative">
                  <div
                    className="h-full bg-orange-500 rounded animate-barber-pole"
                    style={{
                      width: `${totals.totalStages > 0 ? Math.min(100, (stages.length / totals.totalStages) * 100) : 0}%`,
                      backgroundImage: 'linear-gradient(45deg, rgba(255,255,255,0.15) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.15) 75%, transparent 75%, transparent)',
                      backgroundSize: '20px 20px',
                    }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white drop-shadow-md">
                    {totals.totalStages > 0 ? Math.min(100, Math.round((stages.length / totals.totalStages) * 100)) : 0}%
                  </span>
                </div>
                <span className="text-[10px] text-text w-12 text-right flex-shrink-0">{stages.length}/{totals.totalStages}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:h-[280px]">
        {/* Tier Distribution - full width on mobile, 1st column on desktop */}
        <div className="lg:col-span-1 lg:row-span-1 h-[280px]">
          <TierDistributionChart data={tierDistribution} />
        </div>
        {/* Placeholder for additional charts - stacked on mobile/tablet, 3 columns on desktop */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:col-span-3">
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
        steamid={validSteamId}
      />
    </div>
  );
}