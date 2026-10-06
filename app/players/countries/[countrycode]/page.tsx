import Link from '@/components/Link';
import { getCountryPlayers, getCountryPlayerCount } from '@/lib/country-cache';
import type { PlayerSortKey } from '@/lib/country-cache';
import { getSteamProfilesFromCache } from '@/lib/steam';
import { isValidCountryCode, getPrimaryCountryName } from '@/lib/countries';
import CountryBadge from '@/components/CountryBadge';
import Pagination from '@/components/Pagination';
import PlayerListTable from '@/components/PlayerListTable';
import PlayersTableSkeleton from '@/components/PlayersTableSkeleton';
import { SkeletonScreen } from '@/components/Skeleton';
import { NavigationPendingProvider, PendingContent } from '@/components/NavigationPending';
import { ITEMS_PER_PAGE, parseIntParam, type SortDirection } from '@/lib/utils';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

interface CountryPageProps {
  params: Promise<{ countrycode: string }>;
  searchParams: Promise<{ page?: string; sort?: string; order?: string }>;
}

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

  if (!isValidCountryCode(countrycode)) {
    notFound();
  }

  const countryCode = countrycode.toUpperCase();
  // Clamp before the cache key / RANK() OFFSET, against this country's own count so the
  // ceiling matches `totalPages` (same filter).
  const countryPlayerCount = await getCountryPlayerCount(countryCode);
  const pageCeiling = Math.max(1, Math.ceil(countryPlayerCount / ITEMS_PER_PAGE));
  const page = parseIntParam(pageParam, { max: pageCeiling });

  const validSortColumns: PlayerSortKey[] = ['rank', 'player', 'points', 'maps', 'lastseen'];
  const validatedSort: PlayerSortKey = validSortColumns.includes(sort as PlayerSortKey)
    ? (sort as PlayerSortKey)
    : 'points';
  const validatedOrder: SortDirection = order === 'asc' ? 'asc' : 'desc';

  const { players, total, totalPages, countryName } = await getCountryPlayers(
    countryCode,
    page,
    ITEMS_PER_PAGE,
    validatedSort,
    validatedOrder
  );

  // A country with no players still renders, with an empty state.
  const displayName = getPrimaryCountryName(countryCode) || countryName;

  const steamIds = players.map(p => p.steamid);
  const avatarsWithData = await getSteamProfilesFromCache(steamIds);

  const queryParams: Record<string, string> = {};
  if (validatedSort !== 'points') queryParams.sort = validatedSort;
  if (validatedOrder !== 'desc') queryParams.order = validatedOrder;

  return (
    <div className="space-y-4">
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
            {total.toLocaleString()} players • Ranked by points within {displayName}
          </p>
        </div>
      </div>

      {/* The provider shows the skeleton instantly on sort/pagination; loading.tsx only covers
          the initial route load. */}
      <NavigationPendingProvider>
        <PendingContent className="space-y-4" fallback={<SkeletonScreen label="Loading country players..."><PlayersTableSkeleton /></SkeletonScreen>}>
          <PlayerListTable
            players={players}
            avatars={avatarsWithData}
            emptyMessage="No players found for this country."
            rankLabel="Rank"
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
