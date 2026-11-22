import {
  Users,
  Map as MapIcon,
  Trophy,
  Activity,
  Flag,
  Layers,
} from 'lucide-react';
import { getMapImagesUrl, SITE_DESCRIPTION, SITE_TITLE } from '@/lib/utils';
import { getSiteUrl } from '@/lib/site-url';
import { serializeJsonLd, websiteJsonLd } from '@/lib/structured-data';
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
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

// Logs and returns `fallback` on failure, so one dead source never blanks the whole page.
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

  // Same cached avatar path as the /players table.
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
  const jsonLd = serializeJsonLd(websiteJsonLd(await getSiteUrl()));

  return (
    <div className="space-y-5">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <section className="pt-1 pb-2 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-text mb-1">
            {SITE_TITLE}
          </h1>
          <p className="text-text-muted text-base max-w-2xl">{SITE_DESCRIPTION}</p>
        </div>
        <JoinServerCTA />
      </section>

      {/* Grouped with the stats so the ticker reads as part of that block, not its own section. */}
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
