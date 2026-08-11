import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getCountriesRankingFromCache, getCountriesStatsFromCache } from '@/lib/country-analytics';
import type { CountrySortKey, SortOrder } from '@/lib/country-analytics';
import CountryBadge from '@/components/CountryBadge';
import Pagination from '@/components/Pagination';
import SortableTableHeader from '@/components/SortableTableHeader';
import CountriesTableSkeleton from '@/components/CountriesTableSkeleton';
import { SkeletonScreen } from '@/components/Skeleton';
import { NavigationPendingProvider, PendingContent } from '@/components/NavigationPending';
import { parseIntParam } from '@/lib/utils';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'All Countries - Players',
  description: 'Full country rankings based on total player points',
};

const BASE_URL = '/players/countries/list';
const COUNTRIES_PER_PAGE = 20;

export default async function CountriesListPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; order?: string; page?: string }>;
}) {
  const params = await searchParams;

  // Parse and validate sort/order parameters
  const sort = (typeof params.sort === 'string' ? params.sort : undefined) as CountrySortKey | undefined || 'points';
  const order = (typeof params.order === 'string' ? params.order : undefined) as SortOrder | undefined || 'desc';

  // Validate sort column
  const validSortColumns: CountrySortKey[] = ['rank', 'country', 'points', 'players'];
  const validatedSort = validSortColumns.includes(sort) ? sort : 'points';

  // Validate order
  const validatedOrder: SortOrder = order === 'asc' ? 'asc' : 'desc';

  // Stats first: `totalCountries` is the length of the ranking list, so it gives
  // the real page ceiling. Clamping before the fetch keeps an out-of-range
  // `?page=` from minting a distinct 24h cache key per value, and
  // `parseIntParam` replaces a bare `parseInt` that let `?page=abc` through
  // as NaN.
  const stats = await getCountriesStatsFromCache();
  const pageCeiling = Math.max(1, Math.ceil(stats.totalCountries / COUNTRIES_PER_PAGE));
  const page = parseIntParam(params.page, { max: pageCeiling });

  // Fetch countries ranking
  const { countries, totalPages } = await getCountriesRankingFromCache(validatedSort, validatedOrder, page, COUNTRIES_PER_PAGE);

  // Build query params for pagination
  const queryParams: Record<string, string> = {};
  if (validatedSort !== 'points') queryParams.sort = validatedSort;
  if (validatedOrder !== 'desc') queryParams.order = validatedOrder;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/players/countries"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text transition-colors mb-3"
        >
          <ArrowLeft className="h-4 w-4" />
          Global Reach
        </Link>
        <h1 className="text-3xl font-bold text-text">All Countries</h1>
        <p className="text-text-muted">
          Country rankings by total points • {stats.totalCountries.toLocaleString()} countries • {stats.totalPlayers.toLocaleString()} players
        </p>
      </div>

      {/* Sort/pagination navigate through the provider, which shows the
          skeleton instantly. loading.tsx only covers the initial route load. */}
      <NavigationPendingProvider>
        <PendingContent fallback={<SkeletonScreen label="Loading countries..."><CountriesTableSkeleton /></SkeletonScreen>}>
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
                      baseUrl={BASE_URL}
                      queryParams={queryParams}
                      defaultOrder="asc"
                    />
                    <SortableTableHeader
                      column="country"
                      label="Country"
                      currentSort={validatedSort}
                      currentOrder={validatedOrder}
                      baseUrl={BASE_URL}
                      queryParams={queryParams}
                      defaultOrder="asc"
                    />
                    <SortableTableHeader
                      column="points"
                      label="Points"
                      currentSort={validatedSort}
                      currentOrder={validatedOrder}
                      baseUrl={BASE_URL}
                      queryParams={queryParams}
                      defaultOrder="desc"
                    />
                    <SortableTableHeader
                      column="players"
                      label="Players"
                      currentSort={validatedSort}
                      currentOrder={validatedOrder}
                      baseUrl={BASE_URL}
                      queryParams={queryParams}
                      defaultOrder="desc"
                    />
                  </tr>
                </thead>
                <tbody className="bg-surface divide-y divide-border">
                  {countries.map((country) => (
                    <tr key={country.country_code} className="hover:bg-surface-hover/50 transition-colors">
                      <td className="px-4 py-2.5 whitespace-nowrap text-sm font-medium text-text-muted">
                        #{country.rank}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <Link
                          href={`/players/countries/${country.country_code}`}
                          className="flex items-center gap-2 hover:text-primary transition-colors"
                        >
                          <CountryBadge
                            countryCode={country.country_code}
                            showName={true}
                          />
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-sm text-text">
                        {country.total_points.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-sm text-text">
                        {country.player_count.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {countries.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-text-muted">
                        No countries found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-4 border-t border-border">
                <Pagination
                  currentPage={page}
                  totalPages={totalPages}
                  baseUrl={BASE_URL}
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
