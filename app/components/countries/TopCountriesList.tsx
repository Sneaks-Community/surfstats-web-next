import Link from '@/components/Link';
import CountryBadge from '@/components/CountryBadge';

export interface TopCountryEntry {
  code: string;
  name: string;
  players: number;
  rank: number;
}

/** Ranked list beside the world map, doubling as its accessible table view (no hover needed). */
export default function TopCountriesList({ countries }: { countries: TopCountryEntry[] }) {
  if (countries.length === 0) return null;

  return (
    <ol className="divide-y divide-border">
      {countries.map((c) => (
        <li key={c.code}>
          <Link
            href={`/players/countries/${c.code}`}
            className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-hover/50 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-xs font-semibold text-text-placeholder w-5 text-right tabular-nums shrink-0">
                {c.rank}
              </span>
              <CountryBadge countryCode={c.code} />
            </div>
            <span className="text-sm font-medium text-text tabular-nums shrink-0">
              {c.players.toLocaleString()}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
