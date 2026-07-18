import { Globe } from 'lucide-react';
import { getCountriesRankingFromCache, getCountriesStatsFromCache } from '@/lib/country-analytics';
import { getNumericCodeFromAlpha2, getPrimaryCountryName } from '@/lib/countries';
import PanelHeader from '@/components/PanelHeader';
import TopCountriesList, { type TopCountryEntry } from '@/app/components/countries/TopCountriesList';
import { WorldReachChart } from '@/app/components/countries/LazyGlobalReach';
import type { WorldReachDatum } from '@/app/components/countries/WorldReachChart';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Countries - Players',
  description: "Global reach of the surf community — players ranked by country",
};

export default async function CountriesPage() {
  // Pull a deep slice for the map (many countries shaded) plus the stats
  // headline. The Top-Countries list beside the map is the accessible twin.
  const [ranking, stats] = await Promise.all([
    getCountriesRankingFromCache('players', 'desc', 1, 250),
    getCountriesStatsFromCache(),
  ]);

  // World map: players per country, matched to map features by ISO numeric code.
  const worldData: WorldReachDatum[] = ranking.countries
    .map((c) => {
      const numeric = getNumericCodeFromAlpha2(c.country_code);
      if (!numeric) return null;
      return {
        // country-analytics uses the ISO code as the identifier, so resolve a
        // human-readable name for the map tooltip (falls back to the code).
        numeric,
        name: getPrimaryCountryName(c.country_code) ?? c.country,
        players: c.player_count,
      };
    })
    .filter((d): d is WorldReachDatum => d !== null);

  // Top countries by player count (positional rank within this list).
  const topCountries: TopCountryEntry[] = ranking.countries.slice(0, 10).map((c, i) => ({
    code: c.country_code,
    name: c.country,
    players: c.player_count,
    rank: i + 1,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-text">Countries</h1>
        <p className="text-text-muted">
          Global reach of the community • {stats.totalCountries.toLocaleString()} countries • {stats.totalPlayers.toLocaleString()} players
        </p>
      </div>

      {/* Global Reach — world choropleth + top countries */}
      {worldData.length > 0 ? (
        <section className="bg-surface border border-border rounded-xl overflow-hidden">
          <PanelHeader
            icon={Globe}
            title="Global Reach"
            action={{ href: '/players/countries/list', label: 'All countries →' }}
          />
          <div className="grid grid-cols-1 lg:grid-cols-3">
            <div className="lg:col-span-2 p-4 border-b border-border lg:border-b-0 lg:border-r">
              <p className="text-sm text-text-muted mb-3">
                Players ranked from{' '}
                <span className="text-text font-semibold">
                  {stats.totalCountries.toLocaleString()}
                </span>{' '}
                countries around the world.
              </p>
              <WorldReachChart data={worldData} />
            </div>
            <TopCountriesList countries={topCountries} />
          </div>
        </section>
      ) : (
        <div className="bg-surface border border-border rounded-xl p-8 text-center text-text-muted">
          No country data available.
        </div>
      )}
    </div>
  );
}
