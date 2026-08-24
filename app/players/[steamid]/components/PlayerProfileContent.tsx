import Link from '@/components/Link';
import { getSteamProfileUrl, type SteamAvatarSet } from '@/lib/steam';
import { Trophy, Activity, Clock } from 'lucide-react';
import Image from 'next/image';
import { formatDate, getDisplayTz } from '@/lib/utils';
import { validatePlayerName } from '@/lib/validators';
import CountryBadge from '@/components/CountryBadge';
import { getCountryCodeFromName, UNKNOWN_COUNTRY_CODE } from '@/lib/countries';
import PlayerPageTabs from './PlayerPageTabs';
import PlayerRecordsTabs from './PlayerRecordsTabs';
import ProgressBar from '@/components/ProgressBar';
import ChartEmptyState from '@/components/ChartEmptyState';
import PlayerTimeDisplay from './PlayerTimeDisplay';
import ActivityHeatmapChart from './ActivityHeatmapChart';
import {
  TierDistributionChart,
  WRPerformanceChart,
  CompletionBreakdownChart,
  CareerTimelineChart,
  MapEngagementChart,
} from './LazyPlayerCharts';
import type { MapEngagementPoint } from '@/lib/player-analytics';

interface PlayerProfileContentProps {
  // Cheap overview: identity + global rank + completion counts, sourced from
  // getPlayerOverviewFromCache. Drives the profile header, stat cards, and
  // progress bars (no dependence on the expensive full lists).
  overview: {
    player: {
      steamid: string;
      name: string;
      country: string;
      points: number;
      lastseen: string;
      rank: number;
    };
    counts: {
      maps: number;
      bonuses: number;
      stages: number;
    };
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
  mapEngagement: MapEngagementPoint[] | null;
  steamid: string;
}

// eslint-disable-next-line @typescript-eslint/require-await -- Server component pattern, data fetching done at route handler level
export default async function PlayerProfileContent({
  overview,
  totals,
  steamAvatars,
  playtimeData,
  linearVsStagedPerTier,
  wrPerformanceData,
  activityHeatmap,
  mapEngagement,
  steamid,
}: PlayerProfileContentProps) {
  // Identity + stats come from the cheap overview query, not the expensive
  // full lists. `counts` replaces the old `maps.length`/`bonuses.length`/etc.
  const player = overview.player;
  const counts = overview.counts;

  // Profile header (identity + stat cards + progress bars). Always visible,
  // above the Overview | Times tabs, so the player stays on screen on both tabs.
  const profileHeader = (
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
                    const countryCode = getCountryCodeFromName(player.country);
                    if (countryCode === UNKNOWN_COUNTRY_CODE) return null;
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
                <span>Last Seen: {player.lastseen ? formatDate(player.lastseen, getDisplayTz()) : 'Unknown'}</span>
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
              <span className="text-2xl font-bold text-text">{counts.maps.toLocaleString()}</span>
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
              <ProgressBar label="Map" current={counts.maps} total={totals.totalMaps} color="blue" />
              <ProgressBar label="Bonus" current={counts.bonuses} total={totals.totalBonuses} color="purple" />
              <ProgressBar label="Stage" current={counts.stages} total={totals.totalStages} color="orange" />
            </div>
          </div>
        </div>
      </div>
  );

  // Analytic charts shown under the Overview tab.
  const overviewSection = (
    <div className="space-y-3">
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
      {/* Tier Distribution Radar */}
      <div className="lg:col-span-1 h-[280px] min-h-[280px]">
        {linearVsStagedPerTier.length > 0 ? (
          <TierDistributionChart data={linearVsStagedPerTier} />
        ) : (
          <ChartEmptyState title="Tier Distribution" message="No data available" />
        )}
      </div>
      {/* Completion Percentile + Activity Heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:col-span-3">
        <div className="h-[280px] lg:h-auto">
          {wrPerformanceData.length > 0 ? (
            <WRPerformanceChart data={wrPerformanceData} />
          ) : (
            <ChartEmptyState title="Completion Percentile" message="No completions" />
          )}
        </div>
        <div className="h-[280px] lg:h-auto">
          {activityHeatmap && activityHeatmap.length > 0 ? (
            <ActivityHeatmapChart data={activityHeatmap} />
          ) : (
            <ChartEmptyState title="Activity Heatmap" message="No connection data" />
          )}
        </div>
      </div>
    </div>
    {/* Second row: additional analytics charts */}
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      {/* Completion Breakdown Doughnut */}
      <div className="h-[280px]">
        {counts.maps + counts.bonuses + counts.stages > 0 ? (
          <CompletionBreakdownChart counts={counts} />
        ) : (
          <ChartEmptyState title="Completion Breakdown" message="No completions" />
        )}
      </div>
      {/* Career Timeline Stacked Bar */}
      <div className="h-[280px]">
        {wrPerformanceData.length > 0 ? (
          <CareerTimelineChart data={wrPerformanceData} />
        ) : (
          <ChartEmptyState title="Career Timeline" message="No completions" />
        )}
      </div>
      {/* Map Engagement Bubble */}
      <div className="h-[280px]">
        {mapEngagement && mapEngagement.length > 0 ? (
          <MapEngagementChart data={mapEngagement} />
        ) : (
          <ChartEmptyState title="Map Engagement" message="No connection data" />
        )}
      </div>
    </div>
    </div>
  );

  // Records Section — gated behind the top-level Times tab. Fetches its full
  // lists on activation (no fetch on the initial render / for crawlers).
  const timesSection = <PlayerRecordsTabs steamid={steamid} counts={counts} />;

  return (
    <div className="space-y-4">
      {profileHeader}
      <PlayerPageTabs overview={overviewSection} times={timesSection} />
    </div>
  );
}
