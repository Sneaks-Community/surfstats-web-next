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
      
      let query = `
        SELECT
          steamid, name, country, points, finishedmaps, lastseen,
          (SELECT COUNT(*) + 1 FROM ck_playerrank pr2 WHERE pr2.points > pr1.points) as rank
        FROM ck_playerrank pr1
      `;
      
      const params: any[] = [];
      
      if (search) {
        query += ` WHERE name LIKE ? OR steamid LIKE ?`;
        params.push(`%${search}%`, `%${search}%`);
      }
      
      query += ` ORDER BY points DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);
      
      const [rows] = await pool.query<PlayerRank[]>(query, params);
      
      // Get total count for pagination
      let countQuery = `SELECT COUNT(*) as total FROM ck_playerrank`;
      const countParams: any[] = [];
      if (search) {
        countQuery += ` WHERE name LIKE ? OR steamid LIKE ?`;
        countParams.push(`%${search}%`, `%${search}%`);
      }
      const [countRows] = await pool.query<RowDataPacket[]>(countQuery, countParams);
      const total = countRows[0].total;
      
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
          <h1 className="text-3xl font-bold text-white">Players</h1>
          <p className="text-zinc-400">Browse and search all {total.toLocaleString()} players</p>
        </div>
        
        <form className="relative w-full sm:w-72">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-zinc-400" />
          </div>
          <input
            type="text"
            name="q"
            defaultValue={q}
            aria-label="Search players by name or SteamID"
            className="block w-full pl-10 pr-3 py-2 border border-zinc-700 rounded-md leading-5 bg-zinc-900 text-zinc-300 placeholder-zinc-400 focus:outline-none focus:bg-zinc-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 sm:text-sm transition-colors"
            placeholder="Search by name or SteamID..."
          />
        </form>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-800">
            <thead className="bg-zinc-900/50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">Rank</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">Player</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">Points</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">Maps</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">Last Seen</th>
              </tr>
            </thead>
            <tbody className="bg-zinc-900 divide-y divide-zinc-800">
              {players.map((player) => {
                const avatar = avatarsWithData.get(player.steamid);
                return (
                  <tr key={player.steamid} className="hover:bg-zinc-800/50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-zinc-300">
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
                        <Link href={`/players/${player.steamid}`} className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors">
                          {player.name || 'Unknown'}
                        </Link>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-300">
                      {player.points.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-300">
                      {player.finishedmaps.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-400">
                      {player.lastseen ? formatDate(player.lastseen) : 'Never'}
                    </td>
                  </tr>
                );
              })}
              {players.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-zinc-400">
                    No players found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 border-t border-zinc-800">
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