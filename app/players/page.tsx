import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import Link from 'next/link';
import Image from 'next/image';
import { Search } from 'lucide-react';
import { unstable_cache } from 'next/cache';
import { cache } from 'react';
import { getSteamProfiles } from '@/lib/steam';
import Pagination from '@/components/Pagination';
import { formatDate } from '@/lib/utils';
import logger from '@/lib/logger';
import { getPlayerCount } from '@/lib/registry-cache';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Players',
};

// Cache Steam profile fetches within a request to avoid duplicate calls
const getCachedSteamProfiles = cache(getSteamProfiles);

interface PlayerRank extends RowDataPacket {
  steamid: string;
  name: string;
  country: string;
  points: number;
  finishedmaps: number;
  lastseen: string;
  rank: number;
}

const getPlayers = unstable_cache(
  async (page: number, search: string) => {
    logger.debug(`[Players] Fetching players list (page: ${page}, search: "${search || 'none'}")`);
    
    try {
      const limit = 20;
      const offset = (page - 1) * limit;
      
      // Use window function for rank calculation (much more efficient than correlated subquery)
      // RANK() OVER (ORDER BY points DESC) calculates rank based on points
      // This is O(n log n) instead of O(n²) for the correlated subquery
      let query: string;
      const params: any[] = [];
      
      if (search) {
        // For search, we need to use a subquery to filter first, then calculate rank
        query = `
          SELECT
            ranked.steamid, ranked.name, ranked.country, ranked.points,
            ranked.finishedmaps, ranked.lastseen, ranked.rank
          FROM (
            SELECT
              steamid, name, country, points, finishedmaps, lastseen,
              RANK() OVER (ORDER BY points DESC) as rank
            FROM ck_playerrank
            WHERE name LIKE ? OR steamid LIKE ?
          ) ranked
          ORDER BY ranked.points DESC
          LIMIT ? OFFSET ?
        `;
        params.push(`%${search}%`, `%${search}%`, limit, offset);
      } else {
        // For non-search, use window function directly with pagination
        query = `
          SELECT
            steamid, name, country, points, finishedmaps, lastseen,
            RANK() OVER (ORDER BY points DESC) as rank
          FROM ck_playerrank
          ORDER BY points DESC
          LIMIT ? OFFSET ?
        `;
        params.push(limit, offset);
      }
      
      const [rows] = await pool.query<PlayerRank[]>(query, params);
      
      // Get total count for pagination
      let total: number;
      if (search) {
        // For search, we need to count matching records
        const countQuery = `SELECT COUNT(*) as total FROM ck_playerrank WHERE name LIKE ? OR steamid LIKE ?`;
        const countParams = [`%${search}%`, `%${search}%`];
        const [countRows] = await pool.query<RowDataPacket[]>(countQuery, countParams);
        total = countRows[0].total;
      } else {
        // Use cached player count for non-search queries
        total = await getPlayerCount();
      }
      
      logger.debug(`[Players] Retrieved ${rows.length} players (page ${page} of ${Math.ceil(total / limit)}, ${total} total)`);
      
      return { players: rows, total, totalPages: Math.ceil(total / limit) };
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      logger.error(`[Players] Failed to fetch players: ${errorMessage}`);
      logger.error(`[Players] Error code: ${error.code || 'N/A'}`);
      return { players: [], total: 0, totalPages: 0 };
    }
  },
  ['players-list'],
  { revalidate: 60 } // Cache for 1 minute
);

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const q = params.q || '';
  const page = parseInt(params.page || '1', 10);
  
  // Fetch players first to get steam IDs
  const { players, total, totalPages } = await getPlayers(page, q);
  
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
                        <Link href={`/players/${player.steamid}`} className="text-primary hover:text-primary font-medium transition-colors">
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