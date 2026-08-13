'use client';

import Link from 'next/link';
import Pagination from '@/components/Pagination';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import SortableTh from '@/components/SortableTh';
import { formatTime, formatDate, formatTimeDiff, type SortDirection } from '@/lib/utils';
import { useDisplayTz } from '@/lib/ClientConfigContext';
import { validatePlayerName } from '@/lib/validators';
import { MIN_SEARCH_LENGTH, type LoadError } from '@/hooks/useRecordSearch';

export type SortField = 'rank' | 'player' | 'time' | 'speed' | 'wrDiff' | 'date';

/** One leaderboard line, whatever tab it came from. */
export interface LeaderboardRow {
  key: string;
  rank: number;
  steamid: string;
  name: string;
  time: number;
  wr_time: number | null;
  startspeed: number;
  date: string;
}

// Medal styling for the top 3, muted otherwise.
const RankBadge = ({ rank }: { rank: number }) => (
  <span
    className={`inline-flex items-center justify-center h-8 w-8 rounded-full font-bold text-sm ${
      rank === 1
        ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30'
        : rank === 2
        ? 'bg-zinc-300/20 text-zinc-300 border border-zinc-300/30'
        : rank === 3
        ? 'bg-amber-700/20 text-amber-600 border border-amber-700/30'
        : 'text-text-placeholder'
    }`}
  >
    {rank}
  </span>
);

const RecordRow = ({ row }: { row: LeaderboardRow }) => {
  const displayTz = useDisplayTz();

  return (
  <tr className="hover:bg-surface-hover/50 transition-colors">
    <td className="px-2 sm:px-4 py-2 whitespace-nowrap">
      <RankBadge rank={row.rank} />
    </td>
    <td className="px-2 sm:px-4 py-2 whitespace-nowrap">
      <Link
        href={`/players/${row.steamid}`}
        className="text-primary hover:text-primary font-medium transition-colors text-base"
        prefetch={false}
      >
        {validatePlayerName(row.name)}
      </Link>
    </td>
    <td className="px-2 sm:px-4 py-2 whitespace-nowrap text-right">
      <span className="font-mono text-lg font-medium text-text">{formatTime(row.time)}</span>
    </td>
    <td className="px-2 sm:px-4 py-2 whitespace-nowrap text-right">
      <span className={`font-mono text-lg font-medium ${row.rank === 1 ? 'text-green-400' : 'text-yellow-400'}`}>
        {formatTimeDiff(row.time, row.wr_time)}
      </span>
    </td>
    <td className="px-2 sm:px-4 py-2 whitespace-nowrap text-right">
      {row.startspeed !== -1 ? (
        <span className="font-mono text-lg font-medium text-text">{row.startspeed.toFixed(1)}</span>
      ) : (
        <span className="text-text-muted">-</span>
      )}
    </td>
    <td className="px-2 sm:px-4 py-2 whitespace-nowrap text-right text-sm text-text-muted">
      {formatDate(row.date, displayTz)}
    </td>
  </tr>
  );
};

/** Full-width message row, so every state below occupies the table body. */
const MessageRow = ({ children }: { children: React.ReactNode }) => (
  <tr>
    <td colSpan={6} className="px-2 sm:px-4 py-8 text-center text-text-muted">
      {children}
    </td>
  </tr>
);

interface LeaderboardTableProps {
  rows: LeaderboardRow[];
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
  /** Raw search box contents, for the "type at least 3 characters" hint. */
  query: string;
  error: LoadError | null;
  loading: boolean;
  loadingLabel: string;
  /** Shown when the load succeeded but there is nothing to list. */
  emptyMessage: string;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

/**
 * The map, bonus and stage tabs are the same leaderboard: identical columns,
 * identical state ladder (too-short query, error, loading, rows, empty) and
 * identical pagination. They differ only in the rows they hand over and in the
 * wording of the loading and empty states.
 */
export default function LeaderboardTable({
  rows,
  sortField,
  sortDirection,
  onSort,
  query,
  error,
  loading,
  loadingLabel,
  emptyMessage,
  page,
  totalPages,
  onPageChange,
}: LeaderboardTableProps) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-surface/50">
            <tr>
              <SortableTh label="Rank" field="rank" className="w-24" onSort={onSort} sortField={sortField} sortDirection={sortDirection} />
              <SortableTh label="Player" field="player" onSort={onSort} sortField={sortField} sortDirection={sortDirection} />
              <SortableTh label="Time" field="time" align="right" onSort={onSort} sortField={sortField} sortDirection={sortDirection} />
              <SortableTh label="Diff" field="wrDiff" align="right" onSort={onSort} sortField={sortField} sortDirection={sortDirection} />
              <SortableTh label="Start Speed" field="speed" align="right" onSort={onSort} sortField={sortField} sortDirection={sortDirection} />
              <SortableTh label="Date" field="date" align="right" onSort={onSort} sortField={sortField} sortDirection={sortDirection} />
            </tr>
          </thead>
          <tbody className="bg-surface divide-y divide-border">
            {query.length > 0 && query.length < MIN_SEARCH_LENGTH ? (
              <MessageRow>Type at least {MIN_SEARCH_LENGTH} characters to search all players.</MessageRow>
            ) : error ? (
              // A 403/429/503 reads as an error the user can retry rather than
              // an empty leaderboard.
              <tr>
                <td colSpan={6} className="px-2 sm:px-4 py-12 text-center">
                  <p className="text-text-muted text-sm font-medium">Couldn&apos;t load records: {error.message}</p>
                  <button
                    onClick={error.retry}
                    className="mt-3 px-3 py-1.5 rounded-lg bg-surface-hover text-text text-sm font-medium hover:bg-surface-hover/70 transition-colors"
                  >
                    Try again
                  </button>
                </td>
              </tr>
            ) : loading ? (
              <tr>
                <td colSpan={6} className="px-2 sm:px-4 py-12 text-center">
                  <div className="flex flex-col items-center justify-center gap-3">
                    <LoadingSpinner />
                    <span className="text-text-muted text-sm font-medium">{loadingLabel}</span>
                  </div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <MessageRow>{emptyMessage}</MessageRow>
            ) : (
              rows.map((row) => <RecordRow key={row.key} row={row} />)
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="px-3 sm:px-6 border-t border-border">
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={onPageChange} />
        </div>
      )}
    </>
  );
}
