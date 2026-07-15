import type { RowDataPacket } from 'mysql2';
import Link from 'next/link';
import { getSteamProfileUrl, type SteamAvatarSet } from '@/lib/steam';
import { Trophy, Activity, Clock } from 'lucide-react';
import Image from 'next/image';
import { formatDate } from '@/lib/utils';
import { validatePlayerName } from '@/lib/validators';
import CountryBadge from '@/components/CountryBadge';
import { countryNameToCode } from '@/lib/countries';
import TierDistributionChart from './LazyTierDistributionChart';
import PlayerRecordsTabs from './PlayerRecordsTabs';
import ProgressBar from '@/components/ProgressBar';
import PlayerTimeDisplay from './PlayerTimeDisplay';
import WRPerformanceChart from './LazyWRPerformanceChart';
import ActivityHeatmapChart from './ActivityHeatmapChart';

// Type definitions for player records
interface MapRecord {
  mapname: string;
  runtimepro: number;
  date: string;
  wr_time: number | null;
  player_rank: number;
  tier: number;
}

interface BonusRecord {
  mapname: string;
  zonegroup: number;
  runtime: number;
  date: string;
  player_rank: number;
}

interface StageRecord {
  map: string;
  stage: number;
  runtime: number;
  date: string;
  player_rank: number;
}

interface PlayerProfileContentProps {
  data: {
    player: RowDataPacket | {
      steamid: string;
      name: string;
      country: string;
      points: number;
      lastseen: string;
      rank: number;
    };
    maps: RowDataPacket[] | Array<{
      mapname: string;
      runtimepro: number;
      date: string;
      tier: number;
      wr_time: number | null;
      player_rank: number;
    }>;
    bonuses: RowDataPacket[] | Array<{
      mapname: string;
      zonegroup: number;
      runtime: number;
      date: string;
      player_rank: number;
    }>;
    stages: RowDataPacket[] | Array<{
      map: string;
      stage: number;
      runtime: number;
      date: string;
      player_rank: number;
    }>;
  };
  incompleteData: {
    incompleteMaps: Array<{
      mapname: string;
      tier: number | null;
      wr_time: number | null;
      mapType: 'linear' | 'staged';
    }>;
    incompleteBonuses: Array<{
      mapname: string;
      zonegroup: number;
      wr_time: number | null;
    }>;
    incompleteStages: Array<{
      map: string;
      stage: number;
    }>;
  };
  totals: {
    totalMaps: number;
    totalBonuses: number;
    totalStages: number;
  };
  steamAvatars: Map<string, SteamAvatarSet> | null;
  playtimeData: {
    totalSeconds: number;
  } | null;
  linearVsStagedPerTier: Array<{
    tier: number;
    linear: number;
    staged: number;
  }>;
  wrPerformanceData: Array<{
    mapname: string;
    wrPercentage: number;
    tier: number;
    date: string;
  }>;
  activityHeatmap: Array<{
    dayOfWeek: number;
    hour: number;
    count: number;
  }> | null;
  steamid: string;
}

// eslint-disable-next-line @typescript-eslint/require-await -- Server component pattern, data fetching done at route handler level
export default async function PlayerProfileContent({
  data,
  incompleteData,
  totals,
  steamAvatars,
  playtimeData,
  linearVsStagedPerTier,
  wrPerformanceData,
  activityHeatmap,
  steamid,
}: PlayerProfileContentProps) {
  const { player, maps, bonuses, stages } = data;

  return (
    <div className="space-y-4">
      {/* Profile Header */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-primary-900 to-background-secondary"></div>
        <div className="px-4 sm:px-6 pb-4 relative">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end -mt-8 sm:-mt-10 mb-4">
            {(() => {
              const profileUrl = getSteamProfileUrl(steamid);
              const avatar = steamAvatars?.get(steamid);
              return profileUrl ? (
                <a
                  href={profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative h-16 w-16 sm:h-24 sm:w-24 rounded-xl overflow-hidden border-4 border-surface flex-shrink-0"
                >
                  {avatar?.avatarfull ? (
                    <Image
                      src={avatar.avatarfull}
                      alt={player.name}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-surface-hover">
                      <span className="text-4xl font-bold text-text-placeholder">{validatePlayerName(player.name).charAt(0).toUpperCase()}</span>
                    </div>
                  )}
                </a>
              ) : (
                <div className="relative h-16 w-16 sm:h-24 sm:w-24 rounded-xl overflow-hidden border-4 border-surface bg-surface-hover flex-shrink-0">
                  {avatar?.avatarfull ? (
                    <Image
                      src={avatar.avatarfull}
                      alt={player.name}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-surface-hover">
                      <span className="text-4xl font-bold text-text-placeholder">{validatePlayerName(player.name).charAt(0).toUpperCase()}</span>
                    </div>
                  )}
                </div>
              );
            })()}
            <div className="flex-1 pb-2">
              <h1 className="text-3xl font-bold text-text">{validatePlayerName(player.name)}</h1>
              <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-text-muted">
                {(() => {
                  const profileUrl = getSteamProfileUrl(steamid);
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
          {linearVsStagedPerTier.length > 0 ? (
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
        {/* WR Performance + Activity Heatmap */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:col-span-3">
          {/* WR Performance Chart */}
          <div className="h-[280px] lg:h-auto">
            {wrPerformanceData.length > 0 ? (
              <WRPerformanceChart data={wrPerformanceData} />
            ) : (
              <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
                <h3 className="text-sm font-semibold text-text mb-2">WR Performance</h3>
                <div className="flex-1 min-h-[200px] flex items-center justify-center text-text-muted text-sm">
                  No completions
                </div>
              </div>
            )}
          </div>
          {/* Activity Heatmap */}
          <div className="h-[280px] lg:h-auto">
            {activityHeatmap && activityHeatmap.length > 0 ? (
              <ActivityHeatmapChart data={activityHeatmap} />
            ) : (
              <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
                <h3 className="text-sm font-semibold text-text mb-2">Activity Heatmap</h3>
                <div className="flex-1 min-h-[200px] flex items-center justify-center text-text-muted text-sm">
                  No connection data
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Records Section - Tabbed Interface */}
      <PlayerRecordsTabs
        maps={maps as MapRecord[]}
        bonuses={bonuses as BonusRecord[]}
        stages={stages as StageRecord[]}
        incompleteMaps={incompleteData.incompleteMaps}
        incompleteBonuses={incompleteData.incompleteBonuses}
        incompleteStages={incompleteData.incompleteStages}
        steamid={steamid}
      />
    </div>
  );
}
