import {
  Users,
  Map as MapIcon,
  Trophy,
  Activity,
  Flag,
  Layers,
} from 'lucide-react';
import { getMapImagesUrl } from '@/lib/utils';
import { getStatsFromCache, getLatestCompletionsFromCache } from '@/lib/dashboard-cache';
import { getPlayersFromCache } from '@/lib/player-cache';
import { EMPTY_SEARCH } from '@/lib/validators';
import { getSteamProfilesFromCache, type SteamAvatarSet } from '@/lib/steam';
import { getAllMapMetadataFromCache, type MapMetadata } from '@/lib/map-cache';
import logger from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';
import StatTile from '@/components/StatTile';
import PanelHeader from '@/components/PanelHeader';
import JoinServerCTA from '@/app/components/home/JoinServerCTA';
import TopPlayersPreview, { type TopPlayerEntry } from '@/app/components/home/TopPlayersPreview';
import FeaturedMaps, { type FeaturedMapEntry } from '@/app/components/home/FeaturedMaps';
import ActivityTicker from '@/app/components/home/ActivityTicker';

// Force dynamic rendering to prevent static generation
export const dynamic = 'force-dynamic';

// Small wrapper: run a cached fetch, log + degrade to a fallback on failure so a
// single dead sub-source never blanks the whole page.
async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    logger.error(`[Home] Failed to load ${label}: ${getErrorMessage(error)}`);
    return fallback;
  }
}

export default async function Home() {
  const [stats, latestCompletions, topPlayersResult, mapMeta] = await Promise.all([
    safe('stats', getStatsFromCache, null),
    safe('latest completions', getLatestCompletionsFromCache, []),
    safe('top players', () => getPlayersFromCache(1, EMPTY_SEARCH), { players: [], total: 0, totalPages: 0 }),
    safe('map metadata', getAllMapMetadataFromCache, new Map<string, MapMetadata>()),
  ]);

  const mapImagesUrl = getMapImagesUrl();

  const topPlayerRows = topPlayersResult.players.slice(0, 10);

  // Steam avatars for the top-10 list — already cached (7-day TTL) via the same
  // path the /players table uses; degrade to no-avatar on any failure.
  const avatars = await safe(
    'top player avatars',
    () => getSteamProfilesFromCache(topPlayerRows.map((p) => p.steamid)),
    new Map<string, SteamAvatarSet>()
  );

  const topPlayers: TopPlayerEntry[] = topPlayerRows.map((p) => ({
    steamid: p.steamid,
    name: p.name,
    country: p.country,
    points: p.points,
    finishedmaps: p.finishedmaps,
    rank: p.rank,
    avatar: avatars.get(p.steamid)?.avatarmedium || null,
  }));

  const featuredMaps: FeaturedMapEntry[] = Array.from(mapMeta.values())
    .sort((a, b) => b.completions - a.completions)
    .slice(0, 9)
    .map((m) => ({ mapname: m.mapname, tier: m.tier, completions: m.completions }));

  const recentRecords = stats?.recentRecords ?? [];

  return (
    <div className="space-y-5">
      {/* Hero header */}
      <section className="pt-1 pb-2 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-text mb-1">
            Welcome to {process.env.NEXT_PUBLIC_SITE_NAME || 'SurfStats'}
          </h1>
          <p className="text-text-muted text-base max-w-2xl">
            {process.env.NEXT_PUBLIC_SITE_DESCRIPTION ||
              'Statistics, leaderboards, and server information for our CS:GO surf community.'}
          </p>
        </div>
        <JoinServerCTA />
      </section>

      {/* KPI stat row + Latest Activity, grouped so the ticker reads as an
          extension of the stats block rather than its own full-height section. */}
      {stats && (
        <section className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatTile icon={Users} value={stats.playerCount} label="Total Players" accent="primary" />
            <StatTile icon={Activity} value={stats.playersMonth} label="Active (30d)" accent="secondary" />
            <StatTile icon={Trophy} value={stats.totalPoints} label="Total Points" accent="primary" />
            <StatTile icon={MapIcon} value={stats.mapCompletions} label="Map Completions" accent="secondary" />
            <StatTile icon={Flag} value={stats.bonusCompletions} label="Bonus Completions" accent="primary" />
            <StatTile icon={Layers} value={stats.stageCompletions} label="Stage Completions" accent="secondary" />
          </div>

          {/* Latest Activity — a single combined marquee (records + completions)
              tucked directly under the stats with just a small label. */}
          {recentRecords.length > 0 || latestCompletions.length > 0 ? (
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="flex items-center gap-1.5 px-4 pt-2 text-xs font-medium uppercase tracking-wider text-text-muted">
                <Activity className="h-3.5 w-3.5" aria-hidden />
                Latest Activity
              </div>
              <ActivityTicker
                records={recentRecords}
                completions={latestCompletions}
                mapImagesUrl={mapImagesUrl}
              />
            </div>
          ) : null}
        </section>
      )}

      {/* Top players + featured maps */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {topPlayers.length > 0 && (
          <section className="bg-surface border border-border rounded-xl overflow-hidden">
            <PanelHeader
              icon={Trophy}
              title="Top Players"
              iconClassName="text-yellow-500"
              action={{ href: '/players', label: 'Full leaderboard →' }}
            />
            <TopPlayersPreview players={topPlayers} />
          </section>
        )}

        {featuredMaps.length > 0 && (
          <section className="bg-surface border border-border rounded-xl overflow-hidden flex flex-col">
            <PanelHeader
              icon={MapIcon}
              title="Popular Maps"
              action={{ href: '/maps', label: 'All maps →' }}
            />
            <FeaturedMaps maps={featuredMaps} mapImagesUrl={mapImagesUrl} />
          </section>
        )}
      </div>
    </div>
  );
}
