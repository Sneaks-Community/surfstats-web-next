import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import Link from 'next/link';
import { Search as SearchIcon, Map as MapIcon, Users, ChevronRight } from 'lucide-react';
import MapImage from '@/components/MapImage';
import { getTierColor, getTierTextColor } from '@/lib/tierColors';
import { sanitizeSearchQuery, sanitizePlayerName } from '@/lib/sanitize';
import logger from '@/lib/logger';

interface PlayerResult extends RowDataPacket {
  steamid: string;
  name: string;
  points: number;
}

interface MapResult extends RowDataPacket {
  mapname: string;
  tier: number;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  // Sanitize search query to prevent XSS and injection
  const query = sanitizeSearchQuery(q);
  
  let players: PlayerResult[] = [];
  let maps: MapResult[] = [];
  
  if (query.length >= 2) {
    try {
      // Search players
      const [playerRows] = await pool.query<PlayerResult[]>(`
        SELECT steamid, name, points
        FROM ck_playerrank
        WHERE name LIKE ? OR steamid LIKE ?
        ORDER BY points DESC
        LIMIT 10
      `, [`%${query}%`, `%${query}%`]);
      players = playerRows;
      
      // Search maps
      const [mapRows] = await pool.query<MapResult[]>(`
        SELECT mapname, tier
        FROM ck_maptier
        WHERE mapname LIKE ?
        ORDER BY mapname ASC
        LIMIT 10
      `, [`%${query}%`]);
      maps = mapRows;
      
      logger.debug(`[Search] Results for "${query}": ${players.length} players, ${maps.length} maps`);
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      logger.error(`[Search] Query failed for "${query}": ${errorMessage}`);
      logger.error(`[Search] Error code: ${error.code || 'N/A'}`);
    }
  }

  const mapImagesUrl = process.env.MAP_IMAGES_URL || 'https://image.gametracker.com/images/maps/160x120/csgo/';

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div className="text-center space-y-4 py-8">
        <h1 className="text-4xl font-bold text-white">Search</h1>
        <form className="relative max-w-2xl mx-auto">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <SearchIcon className="h-6 w-6 text-zinc-400" />
          </div>
          <input
            type="text"
            name="q"
            defaultValue={query}
            className="block w-full pl-12 pr-4 py-4 border border-zinc-700 rounded-xl leading-5 bg-zinc-900 text-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:bg-zinc-800 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500 transition-all shadow-lg"
            placeholder="Search for players (name, SteamID) or maps..."
            autoFocus
          />
        </form>
      </div>

      {query.length > 0 && query.length < 2 && (
        <div className="text-center text-zinc-400 py-8">
          Please enter at least 2 characters to search.
        </div>
      )}

      {query.length >= 2 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Players Results */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <Users className="h-5 w-5 text-emerald-500" />
                Players
              </h2>
              <span className="text-sm text-zinc-500">{players.length} results</span>
            </div>
            
            {players.length > 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800">
                {players.map((player) => (
                  <Link 
                    key={player.steamid} 
                    href={`/players/${player.steamid}`}
                    className="flex items-center justify-between p-4 hover:bg-zinc-800/50 transition-colors group"
                  >
                    <div>
                      <div className="font-medium text-emerald-400 group-hover:text-emerald-300 transition-colors">
                        {sanitizePlayerName(player.name)}
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">{player.steamid}</div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-sm text-zinc-400 text-right">
                        <div className="font-medium text-zinc-300">{player.points.toLocaleString()}</div>
                        <div className="text-[10px] uppercase tracking-wider">Points</div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500">
                No players found matching {'"'}{query}{'"'}
              </div>
            )}
            
            {players.length === 10 && (
              <div className="text-center">
                <Link href={`/players?q=${encodeURIComponent(query)}`} className="text-sm text-emerald-500 hover:text-emerald-400 hover:underline">
                  View all player results &rarr;
                </Link>
              </div>
            )}
          </div>

          {/* Maps Results */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <MapIcon className="h-5 w-5 text-blue-500" />
                Maps
              </h2>
              <span className="text-sm text-zinc-500">{maps.length} results</span>
            </div>
            
            {maps.length > 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800">
                {maps.map((map) => (
                  <Link 
                    key={map.mapname} 
                    href={`/maps/${map.mapname}`}
                    className="flex items-center justify-between p-4 hover:bg-zinc-800/50 transition-colors group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="relative h-12 w-16 rounded overflow-hidden bg-zinc-800 flex-shrink-0">
                        <MapImage
                          src={`${mapImagesUrl}${map.mapname}.jpg`}
                          alt={map.mapname}
                          fill
                          className="object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      <div>
                        <div className="font-medium text-emerald-400 group-hover:text-emerald-300 transition-colors">
                          {map.mapname}
                        </div>
                        <div className={`text-xs mt-0.5 ${getTierTextColor(map.tier)}`}>Tier {map.tier}</div>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500">
                No maps found matching {'"'}{query}{'"'}
              </div>
            )}
            
            {maps.length === 10 && (
              <div className="text-center">
                <Link href={`/maps?q=${encodeURIComponent(query)}`} className="text-sm text-emerald-500 hover:text-emerald-400 hover:underline">
                  View all map results &rarr;
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}