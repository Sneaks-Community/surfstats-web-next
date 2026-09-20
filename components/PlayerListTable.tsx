import Link from '@/components/Link';
import Image from 'next/image';
import SortLink from '@/components/SortLink';
import { formatDate, getDisplayTz } from '@/lib/utils';

/** Minimal shape both `PlayerRank` and `CountryPlayer` satisfy structurally. */
export interface PlayerListEntry {
  steamid: string;
  name: string;
  rank: number;
  points: number;
  finishedmaps: number;
  lastseen: string;
}

type AvatarMap = Map<string, { avatarmedium?: string | null } | undefined>;

/** When present, the column headers become clickable sort controls. */
export interface PlayerListSort {
  baseUrl: string;
  queryParams: Record<string, string>;
  currentSort: string;
  currentOrder: 'asc' | 'desc';
}

interface PlayerListTableProps {
  players: PlayerListEntry[];
  avatars: AvatarMap;
  emptyMessage: string;
  sort?: PlayerListSort;
  /**
   * Header for the rank column. The country page passes "Country Rank" because
   * its `rank` is computed within the country, not against the global list.
   */
  rankLabel?: string;
}

// Shared column widths so the header and every row align. `player` takes the
// slack (flex-1) so the numeric columns pack tightly on the right instead of
// spreading across the full width. Widths shrink below `sm`, where Last Seen
// drops out of the grid and moves under the player name instead.
const COLUMNS = [
  { key: 'rank', label: 'Rank', short: '#', width: 'w-11 sm:w-20', right: false, defaultOrder: 'asc' as const },
  { key: 'player', label: 'Player', short: 'Player', width: 'flex-1 min-w-0', right: false, defaultOrder: 'asc' as const },
  { key: 'points', label: 'Points', short: 'Pts', width: 'w-14 sm:w-20 flex', right: true, defaultOrder: 'desc' as const },
  { key: 'maps', label: 'Maps', short: 'Maps', width: 'w-10 sm:w-16 flex', right: true, defaultOrder: 'desc' as const },
  { key: 'lastseen', label: 'Last Seen', short: 'Last Seen', width: 'hidden sm:flex sm:w-24', right: true, defaultOrder: 'desc' as const },
];

/** Swaps in an abbreviated label below `sm`, where the column is too narrow. */
function ColLabel({ short, full }: { short: string; full: string }) {
  if (short === full) return <>{full}</>;
  return (
    <>
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{full}</span>
    </>
  );
}

function Header({ sort, rankLabel }: { sort?: PlayerListSort; rankLabel: string }) {
  return (
    <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 bg-surface/50 border-b border-border">
      {COLUMNS.map((col) => {
        const full = col.key === 'rank' ? rankLabel : col.label;
        const label = <ColLabel short={col.short} full={full} />;
        return (
        <div
          key={col.key}
          className={`${col.width} ${col.right ? 'justify-end text-right' : ''} text-[11px] sm:text-xs font-medium text-text-muted uppercase tracking-wider`}
        >
          {sort ? (
            <SortLink
              column={col.key}
              label={label}
              currentSort={sort.currentSort}
              currentOrder={sort.currentOrder}
              baseUrl={sort.baseUrl}
              queryParams={sort.queryParams}
              defaultOrder={col.defaultOrder}
            />
          ) : (
            <span>{label}</span>
          )}
        </div>
        );
      })}
    </div>
  );
}

function Row({ player, avatar }: { player: PlayerListEntry; avatar?: { avatarmedium?: string | null } }) {
  const lastSeen = player.lastseen ? formatDate(player.lastseen, getDisplayTz()) : 'Never';
  return (
    <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 hover:bg-surface-hover/50 transition-colors">
      <div className="w-11 sm:w-20 text-xs sm:text-sm font-medium text-text-muted tabular-nums">
        <span className="hidden sm:inline">#</span>{player.rank}
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {avatar?.avatarmedium && (
          <Image
            src={avatar.avatarmedium}
            alt={`${player.name}'s avatar`}
            width={28}
            height={28}
            className="rounded-full shrink-0"
          />
        )}
        <div className="min-w-0">
          <Link
            href={`/players/${player.steamid}`}
            className="block text-primary hover:text-primary font-medium transition-colors truncate"
          >
            {player.name || 'Unknown'}
          </Link>
          <div className="sm:hidden text-xs text-text-muted">{lastSeen}</div>
        </div>
      </div>
      <div className="w-14 sm:w-20 text-right text-xs sm:text-sm text-text tabular-nums">{player.points.toLocaleString()}</div>
      <div className="w-10 sm:w-16 text-right text-xs sm:text-sm text-text tabular-nums">{player.finishedmaps.toLocaleString()}</div>
      <div className="hidden sm:block w-24 text-right text-sm text-text-muted">{lastSeen}</div>
    </div>
  );
}

/**
 * A compact, two-column player leaderboard. The page's 20 players are split
 * 10/10 into side-by-side columns on wide screens (using the horizontal space
 * and halving the height) and collapse to a single continuous list below `xl`.
 * Numeric columns are right-aligned with fixed widths so they group tightly.
 */
export default function PlayerListTable({
  players,
  avatars,
  emptyMessage,
  sort,
  rankLabel = 'Rank',
}: PlayerListTableProps) {
  if (players.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-8 text-center text-text-muted">{emptyMessage}</div>
      </div>
    );
  }

  const half = Math.ceil(players.length / 2);
  const left = players.slice(0, half);
  const right = players.slice(half);

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="grid grid-cols-1 xl:grid-cols-2">
        {/* Left column: ranks 1–10 (or first half). */}
        <div className="xl:border-r border-border">
          <Header sort={sort} rankLabel={rankLabel} />
          <div className="divide-y divide-border">
            {left.map((player) => (
              <Row key={player.steamid} player={player} avatar={avatars.get(player.steamid)} />
            ))}
          </div>
        </div>

        {/* Right column: ranks 11–20 (or second half). The header only shows
            when the columns are side-by-side; stacked on mobile it reads as one
            continuous list under the left column's header. */}
        {right.length > 0 && (
          <div className="border-t border-border xl:border-t-0">
            <div className="hidden xl:block">
              <Header sort={sort} rankLabel={rankLabel} />
            </div>
            <div className="divide-y divide-border">
              {right.map((player) => (
                <Row key={player.steamid} player={player} avatar={avatars.get(player.steamid)} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
