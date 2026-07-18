import Link from 'next/link';
import Image from 'next/image';
import CountryBadge from '@/components/CountryBadge';

export interface TopPlayerEntry {
  steamid: string;
  name: string;
  country: string;
  points: number;
  finishedmaps: number;
  rank: number;
  /** Steam avatar URL (medium), or null when unavailable. */
  avatar: string | null;
}

// Medal tones for the podium (gold / silver / bronze are a universal convention,
// not theme colors); everyone else gets a muted chip.
function rankChipClass(rank: number): string {
  if (rank === 1) return 'bg-amber-400/15 text-amber-400';
  if (rank === 2) return 'bg-zinc-300/15 text-zinc-300';
  if (rank === 3) return 'bg-orange-400/15 text-orange-400';
  return 'bg-surface-hover text-text-muted';
}

/**
 * Top-ranked players "hall of fame" preview. Aspirational, competitive — it
 * gives newcomers something to climb toward.
 */
export default function TopPlayersPreview({ players }: { players: TopPlayerEntry[] }) {
  if (players.length === 0) return null;

  return (
    <ol className="divide-y divide-border">
      {players.map((p) => (
        <li key={p.steamid}>
          <Link
            href={`/players/${p.steamid}`}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover/50 transition-colors"
          >
            <span
              className={`flex items-center justify-center h-7 w-7 rounded-md text-xs font-bold tabular-nums shrink-0 ${rankChipClass(p.rank)}`}
            >
              {p.rank}
            </span>
            {p.avatar ? (
              <Image
                src={p.avatar}
                alt={`${p.name || 'Player'}'s avatar`}
                width={36}
                height={36}
                className="h-9 w-9 rounded-full shrink-0 bg-surface-hover"
              />
            ) : (
              <span className="h-9 w-9 rounded-full shrink-0 bg-surface-hover" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-text truncate">{p.name || 'Unknown'}</div>
              <div className="mt-0.5">
                <CountryBadge countryCode={p.country} />
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-semibold text-text tabular-nums">{p.points.toLocaleString()}</div>
              <div className="text-xs text-text-muted tabular-nums">{p.finishedmaps.toLocaleString()} maps</div>
            </div>
          </Link>
        </li>
      ))}
    </ol>
  );
}
