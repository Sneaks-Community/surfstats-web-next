import Link from 'next/link';
import { getCountriesRankingFromCache, getCountriesStatsFromCache } from '@/lib/country-analytics';
import type { CountrySortKey, SortOrder } from '@/lib/country-analytics';
import CountryBadge from '@/components/CountryBadge';
import Pagination from '@/components/Pagination';
import SortableTableHeader from '@/components/SortableTableHeader';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Countries - Players',
  description: 'Country rankings based on total player points',
};

export default async function CountriesPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; order?: string; page?: string }>;
}) {
  const params = await searchParams;
  
  // Parse and validate sort/order parameters
  const sort = (params.sort as CountrySortKey) || 'points';
  const order = (params.order as SortOrder) || 'desc';
  const page = parseInt(params.page || '1', 10);
  
  // Validate sort column
  const validSortColumns: CountrySortKey[] = ['rank', 'country', 'points', 'players'];
  const validatedSort = validSortColumns.includes(sort) ? sort : 'points';
  
  // Validate order
  const validatedOrder: SortOrder = order === 'asc' ? 'asc' : 'desc';
  
  // Fetch countries ranking
  const { countries, totalPages } = await getCountriesRankingFromCache(validatedSort, validatedOrder, page, 25);
    const stats = await getCountriesStatsFromCache();
  
  // Build query params for pagination
  const queryParams: Record<string, string> = {};
  if (validatedSort !== 'points') queryParams.sort = validatedSort;
  if (validatedOrder !== 'desc') queryParams.order = validatedOrder;
  
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-text">Countries</h1>
        <p className="text-text-muted">
          Country rankings by total points • {stats.totalCountries.toLocaleString()} countries • {stats.totalPlayers.toLocaleString()} players
        </p>
      </div>

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
                  baseUrl="/players/countries"
                  queryParams={queryParams}
                  defaultOrder="asc"
                />
                <SortableTableHeader
                  column="country"
                  label="Country"
                  currentSort={validatedSort}
                  currentOrder={validatedOrder}
                  baseUrl="/players/countries"
                  queryParams={queryParams}
                  defaultOrder="asc"
                />
                <SortableTableHeader
                  column="points"
                  label="Points"
                  currentSort={validatedSort}
                  currentOrder={validatedOrder}
                  baseUrl="/players/countries"
                  queryParams={queryParams}
                  defaultOrder="desc"
                />
                <SortableTableHeader
                  column="players"
                  label="Players"
                  currentSort={validatedSort}
                  currentOrder={validatedOrder}
                  baseUrl="/players/countries"
                  queryParams={queryParams}
                  defaultOrder="desc"
                />
              </tr>
            </thead>
            <tbody className="bg-surface divide-y divide-border">
              {countries.map((country) => (
                <tr key={country.country_code} className="hover:bg-surface-hover/50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-text-muted">
                    #{country.rank}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
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
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                    {country.total_points.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
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
          <div className="px-6 border-t border-border">
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              baseUrl="/players/countries"
              queryParams={queryParams}
            />
          </div>
        )}
      </div>
    </div>
  );
}