import { cache } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { getCountryPlayers } from '@/lib/country-analytics';
import type { PlayerSortKey, SortOrder } from '@/lib/country-analytics';
import { getSteamProfilesFromCache } from '@/lib/steam';
import { isValidCountryCode, getPrimaryCountryName } from '@/lib/countries';
import CountryBadge from '@/components/CountryBadge';
import Pagination from '@/components/Pagination';
import SortableTableHeader from '@/components/SortableTableHeader';
import PlayersTableSkeleton from '@/components/PlayersTableSkeleton';
import { SkeletonScreen } from '@/components/Skeleton';
import { NavigationPendingProvider, PendingContent } from '@/components/NavigationPending';
import { formatDate, parseIntParam } from '@/lib/utils';
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
  const page = parseIntParam(pageParam);

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
    20,
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
    <div className="space-y-6">
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
        <PendingContent fallback={<SkeletonScreen label="Loading country players..."><PlayersTableSkeleton /></SkeletonScreen>}>
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-surface/50">
                  <tr>
                    <SortableTableHeader
                      column="rank"
                      label="Rank"
                      currentSort={validatedSort}
                      currentOrder={validatedOrder}
                      baseUrl={`/players/countries/${countryCode}`}
                      queryParams={queryParams}
                      defaultOrder="asc"
                    />
                    <SortableTableHeader
                      column="player"
                      label="Player"
                      currentSort={validatedSort}
                      currentOrder={validatedOrder}
                      baseUrl={`/players/countries/${countryCode}`}
                      queryParams={queryParams}
                      defaultOrder="asc"
                    />
                    <SortableTableHeader
                      column="points"
                      label="Points"
                      currentSort={validatedSort}
                      currentOrder={validatedOrder}
                      baseUrl={`/players/countries/${countryCode}`}
                      queryParams={queryParams}
                      defaultOrder="desc"
                    />
                    <SortableTableHeader
                      column="maps"
                      label="Maps"
                      currentSort={validatedSort}
                      currentOrder={validatedOrder}
                      baseUrl={`/players/countries/${countryCode}`}
                      queryParams={queryParams}
                      defaultOrder="desc"
                    />
                    <SortableTableHeader
                      column="lastseen"
                      label="Last Seen"
                      currentSort={validatedSort}
                      currentOrder={validatedOrder}
                      baseUrl={`/players/countries/${countryCode}`}
                      queryParams={queryParams}
                      defaultOrder="desc"
                    />
                  </tr>
                </thead>
                <tbody className="bg-surface divide-y divide-border">
                  {players.map((player) => {
                    const avatar = avatarsWithData.get(player.steamid);
                    return (
                      <tr key={player.steamid} className="hover:bg-surface-hover/50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-text-muted">
                          #{player.rank}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-3">
                            {avatar?.avatarmedium && (
                              <Image
                                src={avatar.avatarmedium}
                                alt={`${player.name}'s avatar`}
                                width={32}
                                height={32}
                                className="rounded-full"
                              />
                            )}
                            <Link
                              href={`/players/${player.steamid}`}
                              prefetch={false}
                              className="text-primary hover:text-primary font-medium transition-colors"
                            >
                              {player.name || 'Unknown'}
                            </Link>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                          {player.points.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                          {player.finishedmaps.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-text-muted">
                          {player.lastseen ? formatDate(player.lastseen) : 'Never'}
                        </td>
                      </tr>
                    );
                  })}
                  {players.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-text-muted">
                        No players found for this country.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-6 border-t border-border">
                <Pagination
                  currentPage={page}
                  totalPages={totalPages}
                  baseUrl={`/players/countries/${countryCode}`}
                  queryParams={queryParams}
                />
              </div>
            )}
          </div>
        </PendingContent>
      </NavigationPendingProvider>
    </div>
  );
}
