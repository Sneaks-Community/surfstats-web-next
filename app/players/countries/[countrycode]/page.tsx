import { cache } from 'react';
import Link from 'next/link';
import { getCountryPlayers, getCountryPlayerCount } from '@/lib/country-analytics';
import { PLAYERS_PAGE_SIZE } from '@/lib/player-cache';
import type { PlayerSortKey, SortOrder } from '@/lib/country-analytics';
import { getSteamProfilesFromCache } from '@/lib/steam';
import { isValidCountryCode, getPrimaryCountryName } from '@/lib/countries';
import CountryBadge from '@/components/CountryBadge';
import Pagination from '@/components/Pagination';
import PlayerListTable from '@/components/PlayerListTable';
import PlayersTableSkeleton from '@/components/PlayersTableSkeleton';
import { SkeletonScreen } from '@/components/Skeleton';
import { NavigationPendingProvider, PendingContent } from '@/components/NavigationPending';
import { parseIntParam } from '@/lib/utils';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

// Cache Steam profile fetches within a request to avoid duplicate calls
const getCachedSteamProfiles = cache(getSteamProfilesFromCache);

interface CountryPageProps {
  params: Promise<{ countrycode: string }>;
  searchParams: Promise<{ page?: string; sort?: string; order?: string }>;
}

// Generate metadata for the page
export async function generateMetadata({ params }: CountryPageProps): Promise<Metadata> {
  const { countrycode } = await params;
  const countryName = getPrimaryCountryName(countrycode);

  if (!countryName) {
    return {
      title: 'Country Not Found',
    };
  }

  return {
    title: `${countryName} - Players - Countries`,
    description: `Players from ${countryName} ranked by points`,
  };
}

export default async function CountryPlayersPage({ params, searchParams }: CountryPageProps) {
  const { countrycode } = await params;
  const { page: pageParam, sort, order } = await searchParams;

  // Validate country code
  if (!isValidCountryCode(countrycode)) {
    notFound();
  }

  const countryCode = countrycode.toUpperCase();
  // Clamp before the value reaches the cache key / RANK() window OFFSET.
  // Uses this country's own count so the ceiling matches the `totalPages` the
  // fetcher reports: the global ranked count is *not* a valid bound here, because
  // the country queries omit the `points > 0` filter the global count applies and
  // so report more pages (see COR-1).
  const countryPlayerCount = await getCountryPlayerCount(countryCode);
  const pageCeiling = Math.max(1, Math.ceil(countryPlayerCount / PLAYERS_PAGE_SIZE));
  const page = parseIntParam(pageParam, { max: pageCeiling });

  // Validate and parse sort parameters
  // Default sort is by points descending (top players first)
  const validSortColumns: PlayerSortKey[] = ['rank', 'player', 'points', 'maps', 'lastseen'];
  const validatedSort: PlayerSortKey = validSortColumns.includes(sort as PlayerSortKey)
    ? (sort as PlayerSortKey)
    : 'points';
  const validatedOrder: SortOrder = order === 'asc' ? 'asc' : 'desc';

  // Fetch players for this country with sorting
  const { players, total, totalPages, countryName } = await getCountryPlayers(
    countryCode,
    page,
    PLAYERS_PAGE_SIZE,
    validatedSort,
    validatedOrder
  );

  // If no players found, still show the page but with empty state
  const displayName = getPrimaryCountryName(countryCode) || countryName;

  // Extract steam IDs and fetch avatars
  const steamIds = players.map(p => p.steamid);
  const avatarsWithData = await getCachedSteamProfiles(steamIds);

  // Build query params for pagination
  const queryParams: Record<string, string> = {};
  if (validatedSort !== 'points') queryParams.sort = validatedSort;
  if (validatedOrder !== 'desc') queryParams.order = validatedOrder;

  return (
    <div className="space-y-4">
      {/* Header with country info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/players/countries"
            className="text-text-muted hover:text-text transition-colors text-sm"
          >
            ← Back to Countries
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <CountryBadge
          countryCode={countryCode}
          showName={false}
          className="text-4xl"
        />
        <div>
          <h1 className="text-3xl font-bold text-text">{displayName}</h1>
          <p className="text-text-muted">
            {total.toLocaleString()} players • Ranked by points
          </p>
        </div>
      </div>

      {/* Sort/pagination navigate through the provider, which shows the
          skeleton instantly. loading.tsx only covers the initial route load. */}
      <NavigationPendingProvider>
        <PendingContent className="space-y-4" fallback={<SkeletonScreen label="Loading country players..."><PlayersTableSkeleton /></SkeletonScreen>}>
          <PlayerListTable
            players={players}
            avatars={avatarsWithData}
            emptyMessage="No players found for this country."
            sort={{
              baseUrl: `/players/countries/${countryCode}`,
              queryParams,
              currentSort: validatedSort,
              currentOrder: validatedOrder,
            }}
          />

          {totalPages > 1 && (
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              baseUrl={`/players/countries/${countryCode}`}
              queryParams={queryParams}
            />
          )}
        </PendingContent>
      </NavigationPendingProvider>
    </div>
  );
}
