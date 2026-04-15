import Link from 'next/link';
import Image from 'next/image';
import { Search } from 'lucide-react';
import { cache } from 'react';
import { getSteamProfilesFromCache } from '@/lib/steam';
import Pagination from '@/components/Pagination';
import { formatDate } from '@/lib/utils';
import { getPlayersFromCache } from '@/lib/player-cache';
import { sanitizeSearchQuery } from '@/lib/sanitize';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Players',
};

// Cache Steam profile fetches within a request to avoid duplicate calls
const getCachedSteamProfiles = cache(getSteamProfilesFromCache);

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const q = sanitizeSearchQuery(params.q);
  const page = parseInt(params.page || '1', 10);
  
  // Fetch players first to get steam IDs
  const { players, total, totalPages } = await getPlayersFromCache(page, q);
  
  // Extract steam IDs and fetch avatars (cached within request via React.cache)
  const steamIds = players.map(p => p.steamid);
  const avatarsWithData = await getCachedSteamProfiles(steamIds);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-text">Players</h1>
          <p className="text-text-muted">Browse and search all {total.toLocaleString()} players</p>
        </div>
        
        <form className="relative w-full sm:w-72">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-text-placeholder" />
          </div>
          <input
            type="text"
            name="q"
            defaultValue={q}
            aria-label="Search players by name or SteamID"
            className="block w-full pl-10 pr-3 py-2 border border-border rounded-md leading-5 bg-background-secondary text-text placeholder-text-placeholder focus:outline-none focus:bg-surface focus:border-border-focus focus:ring-1 focus:ring-border-focus sm:text-sm transition-colors"
            placeholder="Search by name or SteamID..."
          />
        </form>
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-surface/50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Rank</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Player</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Points</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Maps</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Last Seen</th>
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
                        {avatar && (
                          <Image
                            src={avatar.avatarmedium}
                            alt={`${player.name}'s avatar`}
                            width={32}
                            height={32}
                            className="rounded-full"
                          />
                        )}
                        <Link href={`/players/${player.steamid}`} prefetch={false} className="text-primary hover:text-primary font-medium transition-colors">
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
                    No players found matching your search.
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
              baseUrl="/players"
              queryParams={q ? { q } : {}}
            />
          </div>
        )}
      </div>
    </div>
  );
}