import { Search } from 'lucide-react';
import { cache } from 'react';
import { getSteamProfilesFromCache } from '@/lib/steam';
import Pagination from '@/components/Pagination';
import PlayerListTable from '@/components/PlayerListTable';
import PlayersTableSkeleton from '@/components/PlayersTableSkeleton';
import { SkeletonScreen } from '@/components/Skeleton';
import { NavigationPendingProvider, PendingContent } from '@/components/NavigationPending';
import { parseIntParam } from '@/lib/utils';
import { getPlayersFromCache } from '@/lib/player-cache';
import { validateSearchQuery } from '@/lib/validators';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Players',
};

// Cache Steam profile fetches within a request to avoid duplicate calls
const getCachedSteamProfiles = cache(getSteamProfilesFromCache);

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const q = validateSearchQuery(params.q);
  const page = parseIntParam(params.page);

  // Fetch players first to get steam IDs
  const { players, total, totalPages } = await getPlayersFromCache(page, q);

  // Extract steam IDs and fetch avatars (cached within request via React.cache)
  const steamIds = players.map(p => p.steamid);
  const avatarsWithData = await getCachedSteamProfiles(steamIds);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-text">Players</h1>
          <p className="text-text-muted">Browse and search all {total.toLocaleString()} ranked players</p>
        </div>

        <form className="relative w-full sm:w-72">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-text-placeholder" />
          </div>
          <input
            type="text"
            name="q"
            defaultValue={q}
            aria-label="Search players by name or SteamID"
            className="block w-full pl-10 pr-3 py-2 border border-border rounded-md leading-5 bg-background-secondary text-text placeholder-text-placeholder focus:outline-none focus:bg-surface focus:border-border-focus focus:ring-1 focus:ring-border-focus sm:text-sm transition-colors"
            placeholder="Search by name or SteamID..."
          />
        </form>
      </div>

      {/* Pagination navigates through the provider, which shows the skeleton
          the instant a page is clicked. `loading.tsx` only fires on the initial
          route load; search-param navigations reuse the segment and would
          otherwise sit frozen until the (uncached) query returns. */}
      <NavigationPendingProvider>
        <PendingContent className="space-y-4" fallback={<SkeletonScreen label="Loading players..."><PlayersTableSkeleton /></SkeletonScreen>}>
          <PlayerListTable
            players={players}
            avatars={avatarsWithData}
            emptyMessage="No players found matching your search."
          />

          {totalPages > 1 && (
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              baseUrl="/players"
              queryParams={q ? { q } : {}}
            />
          )}
        </PendingContent>
      </NavigationPendingProvider>
    </div>
  );
}
