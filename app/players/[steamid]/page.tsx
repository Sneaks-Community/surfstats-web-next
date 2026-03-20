import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import Link from 'next/link';
import { getSteamAvatars, getSteamProfileUrl } from '@/lib/steam';
import { Trophy, Activity, Map as MapIcon, Target, Layers, Clock } from 'lucide-react';
import Image from 'next/image';
import { unstable_cache } from 'next/cache';
import { formatTime, formatDate, formatPlaytime } from '@/lib/utils';
import { sanitizeSteamId, sanitizePlayerName } from '@/lib/sanitize';
import CountryBadge from '@/components/CountryBadge';
import ProgressBar from '@/components/ProgressBar';
import { getTotalsCached } from '@/lib/cache';
import { getPlayerTimeOnServer } from '@/lib/player-analytics';
import logger from '@/lib/logger';

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
}

interface BonusRecord extends RowDataPacket {
  mapname: string;
  zonegroup: number;
  runtime: number;
  date: string;
}

interface StageRecord extends RowDataPacket {
  map: string;
  stage: number;
  runtime: number;
  date: string;
}

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
      const [mapsResult, bonusesResult, stagesResult] = await Promise.all([
        pool.query<MapRecord[]>(`
          SELECT mapname, runtimepro, date
          FROM ck_playertimes
          WHERE steamid = ?
          ORDER BY date DESC
        `, [steamid]),
        pool.query<BonusRecord[]>(`
          SELECT mapname, zonegroup, runtime, date
          FROM ck_bonus
          WHERE steamid = ?
          ORDER BY date DESC
        `, [steamid]),
        pool.query<StageRecord[]>(`
          SELECT map, stage, runtime, date
          FROM ck_stages
          WHERE steamid = ?
          ORDER BY date DESC
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
      <div className="text-center py-20 bg-zinc-900 border border-zinc-800 rounded-xl">
        <h1 className="text-2xl font-bold text-white mb-2">Invalid SteamID</h1>
        <p className="text-zinc-400">The provided SteamID format is invalid.</p>
        <Link href="/players" className="inline-block mt-6 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition-colors">
          Back to Players
        </Link>
      </div>
    );
  }
  
  const data = await getPlayerData(validSteamId);
  
  if (!data) {
    return (
      <div className="text-center py-20 bg-zinc-900 border border-zinc-800 rounded-xl">
        <h1 className="text-2xl font-bold text-white mb-2">Player Not Found</h1>
        <p className="text-zinc-400">The player with SteamID {decodedSteamId} could not be found.</p>
        <Link href="/players" className="inline-block mt-6 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition-colors">
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

  return (
    <div className="space-y-8">
      {/* Profile Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="h-32 bg-gradient-to-r from-emerald-900 to-zinc-900"></div>
        <div className="px-6 sm:px-10 pb-8 relative">
          <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-end -mt-12 sm:-mt-16 mb-6">
            <div className="relative h-24 w-24 sm:h-32 sm:w-32 rounded-xl overflow-hidden border-4 border-zinc-900 bg-zinc-800 flex-shrink-0">
              {steamAvatars?.avatarfull ? (
                <Image
                  src={steamAvatars.avatarfull}
                  alt={player.name}
                  fill
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-zinc-800">
                  <span className="text-4xl font-bold text-zinc-600">{sanitizePlayerName(player.name).charAt(0).toUpperCase()}</span>
                </div>
              )}
            </div>
            <div className="flex-1 pb-2">
              <h1 className="text-3xl font-bold text-white">{sanitizePlayerName(player.name)}</h1>
              <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-zinc-400">
                <span className="font-mono bg-zinc-800 px-2 py-1 rounded text-zinc-300">{player.steamid}</span>
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
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-md font-medium transition-colors text-sm"
                  >
                    Steam Profile
                  </a>
                ) : null;
              })()}
            </div>
          </div>

          {/* Stats Row */}
          <div className="flex flex-wrap gap-3 justify-center items-center">
            <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-800 min-w-[100px] h-[72px] flex flex-col justify-center">
              <div className="flex items-center justify-center gap-1 text-zinc-400 mb-1">
                <Trophy className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                <span className="text-xs font-medium uppercase tracking-wider">Rank</span>
              </div>
              <div className="text-xl font-bold text-white text-center">#{player.rank}</div>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-800 min-w-[100px] h-[72px] flex flex-col justify-center">
              <div className="flex items-center justify-center gap-1 text-zinc-400 mb-1">
                <Activity className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                <span className="text-xs font-medium uppercase tracking-wider">Points</span>
              </div>
              <div className="text-xl font-bold text-white text-center">{player.points.toLocaleString()}</div>
            </div>
            {playtimeData && (
              <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-800 min-w-[110px] h-[72px] flex flex-col justify-center">
                <div className="flex items-center justify-center gap-1 text-zinc-400 mb-1">
                  <Clock className="h-4 w-4 text-cyan-500 flex-shrink-0" />
                  <span className="text-xs font-medium uppercase tracking-wider">Time Played</span>
                </div>
                <div className="text-xl font-bold text-white text-center">
                  {formatPlaytime(playtimeData.totalSeconds)}
                </div>
              </div>
            )}
            {/* Progress bars stacked horizontally in a 72px tall container */}
            <div className="bg-zinc-800/50 rounded-lg p-2 border border-zinc-800 h-[72px] flex flex-col justify-center gap-1.5 w-[240px]">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-blue-400 w-8 flex-shrink-0">Map</span>
                <div className="flex-1 h-3 bg-zinc-700 rounded overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded animate-barber-pole"
                    style={{
                      width: `${totals.totalMaps > 0 ? Math.min(100, (maps.length / totals.totalMaps) * 100) : 0}%`,
                      backgroundImage: 'linear-gradient(45deg, rgba(255,255,255,0.15) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.15) 75%, transparent 75%, transparent)',
                      backgroundSize: '20px 20px',
                    }}
                  />
                </div>
                <span className="text-[10px] text-zinc-300 w-12 text-right flex-shrink-0">{maps.length}/{totals.totalMaps}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-purple-400 w-8 flex-shrink-0">Bonus</span>
                <div className="flex-1 h-3 bg-zinc-700 rounded overflow-hidden">
                  <div
                    className="h-full bg-purple-500 rounded animate-barber-pole"
                    style={{
                      width: `${totals.totalBonuses > 0 ? Math.min(100, (bonuses.length / totals.totalBonuses) * 100) : 0}%`,
                      backgroundImage: 'linear-gradient(45deg, rgba(255,255,255,0.15) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.15) 75%, transparent 75%, transparent)',
                      backgroundSize: '20px 20px',
                    }}
                  />
                </div>
                <span className="text-[10px] text-zinc-300 w-12 text-right flex-shrink-0">{bonuses.length}/{totals.totalBonuses}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-orange-400 w-8 flex-shrink-0">Stage</span>
                <div className="flex-1 h-3 bg-zinc-700 rounded overflow-hidden">
                  <div
                    className="h-full bg-orange-500 rounded animate-barber-pole"
                    style={{
                      width: `${totals.totalStages > 0 ? Math.min(100, (stages.length / totals.totalStages) * 100) : 0}%`,
                      backgroundImage: 'linear-gradient(45deg, rgba(255,255,255,0.15) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.15) 75%, transparent 75%, transparent)',
                      backgroundSize: '20px 20px',
                    }}
                  />
                </div>
                <span className="text-[10px] text-zinc-300 w-12 text-right flex-shrink-0">{stages.length}/{totals.totalStages}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Records Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Maps */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col h-[600px]" style={{ contentVisibility: 'auto', containIntrinsicSize: '0 600px' }}>
          <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between sticky top-0">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <MapIcon className="h-5 w-5 text-blue-500" />
              Map Records
            </h2>
            <span className="bg-zinc-800 text-zinc-300 text-xs px-2 py-1 rounded-full">{maps.length}</span>
          </div>
          <div className="overflow-y-auto flex-1 p-0">
            <div className="divide-y divide-zinc-800">
              {maps.map((record, i) => (
                <div key={i} className="px-6 py-3 hover:bg-zinc-800/50 transition-colors flex justify-between items-center">
                  <div>
                    <Link href={`/maps/${record.mapname}`} className="text-emerald-400 hover:underline font-medium">
                      {sanitizePlayerName(record.mapname)}
                    </Link>
                    <div className="text-xs text-zinc-500 mt-0.5">{formatDate(record.date)}</div>
                  </div>
                  <div className="font-mono text-zinc-200">
                    {formatTime(record.runtimepro)}
                  </div>
                </div>
              ))}
              {maps.length === 0 && (
                <div className="p-6 text-center text-zinc-500">No map records found.</div>
              )}
            </div>
          </div>
        </div>

        {/* Bonuses */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col h-[600px]" style={{ contentVisibility: 'auto', containIntrinsicSize: '0 600px' }}>
          <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between sticky top-0">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Target className="h-5 w-5 text-purple-500" />
              Bonus Records
            </h2>
            <span className="bg-zinc-800 text-zinc-300 text-xs px-2 py-1 rounded-full">{bonuses.length}</span>
          </div>
          <div className="overflow-y-auto flex-1 p-0">
            <div className="divide-y divide-zinc-800">
              {bonuses.map((record, i) => (
                <div key={i} className="px-6 py-3 hover:bg-zinc-800/50 transition-colors flex justify-between items-center">
                  <div>
                    <Link href={`/maps/${record.mapname}`} className="text-emerald-400 hover:underline font-medium">
                      {sanitizePlayerName(record.mapname)}
                    </Link>
                    <span className="ml-2 text-xs bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded">B{record.zonegroup}</span>
                    <div className="text-xs text-zinc-500 mt-0.5">{formatDate(record.date)}</div>
                  </div>
                  <div className="font-mono text-zinc-200">
                    {formatTime(record.runtime)}
                  </div>
                </div>
              ))}
              {bonuses.length === 0 && (
                <div className="p-6 text-center text-zinc-500">No bonus records found.</div>
              )}
            </div>
          </div>
        </div>

        {/* Stages */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col h-[600px]" style={{ contentVisibility: 'auto', containIntrinsicSize: '0 600px' }}>
          <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between sticky top-0">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Layers className="h-5 w-5 text-orange-500" />
              Stage Records
            </h2>
            <span className="bg-zinc-800 text-zinc-300 text-xs px-2 py-1 rounded-full">{stages.length}</span>
          </div>
          <div className="overflow-y-auto flex-1 p-0">
            <div className="divide-y divide-zinc-800">
              {stages.map((record, i) => (
                <div key={i} className="px-6 py-3 hover:bg-zinc-800/50 transition-colors flex justify-between items-center">
                  <div>
                    <Link href={`/maps/${record.map}`} className="text-emerald-400 hover:underline font-medium">
                      {sanitizePlayerName(record.map)}
                    </Link>
                    <span className="ml-2 text-xs bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded">S{record.stage}</span>
                    <div className="text-xs text-zinc-500 mt-0.5">{formatDate(record.date)}</div>
                  </div>
                  <div className="font-mono text-zinc-200">
                    {formatTime(record.runtime)}
                  </div>
                </div>
              ))}
              {stages.length === 0 && (
                <div className="p-6 text-center text-zinc-500">No stage records found.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}