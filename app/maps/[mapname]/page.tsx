import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import { getSteamProfileUrl } from '@/lib/steam';
import Link from 'next/link';
import { Search, Map as MapIcon, Users, Trophy, Layers, Target } from 'lucide-react';
import MapImage from '@/components/MapImage';
import Pagination from '@/components/Pagination';
import { unstable_cache } from 'next/cache';
import { getTierColor } from '@/lib/tierColors';
import { formatTime, formatDate } from '@/lib/utils';
import { sanitizeMapName, sanitizeSearchQuery, sanitizePlayerName } from '@/lib/sanitize';
import logger from '@/lib/logger';

interface MapData extends RowDataPacket {
  mapname: string;
  tier: number;
  mapper: string;
  mappersteam: string;
  bonuses: number;
  stages: number;
}

interface MapRecord extends RowDataPacket {
  steamid: string;
  name: string;
  runtimepro: number;
  date: string;
  rank: number;
}

const getMapData = unstable_cache(
  async (mapname: string, page: number, search: string) => {
    logger.debug(`[Map] Fetching data for: ${mapname} (page: ${page}, search: "${search || 'none'}")`);
    
    try {
      // Get map info
      const [mapRows] = await pool.query<MapData[]>(`
        SELECT
          m.mapname, m.tier, m.mapper, m.mappersteam,
          (SELECT COUNT(DISTINCT zonegroup) FROM ck_zones z WHERE z.mapname = m.mapname AND z.zonegroup > 0) as bonuses,
          (SELECT COUNT(*) + 1 FROM ck_zones z WHERE z.mapname = m.mapname AND z.zonetype = 3) as stages
        FROM ck_maptier m
        WHERE m.mapname = ?
      `, [mapname]);

      if (mapRows.length === 0) {
        logger.warn(`[Map] No map found with name: ${mapname}`);
        return null;
      }
      const map = mapRows[0];

      // Get records with pagination and search
      const limit = 25;
      const offset = (page - 1) * limit;
      
      let query = `
        SELECT 
          pt.steamid, pt.name, pt.runtimepro, pt.date,
          (SELECT COUNT(*) + 1 FROM ck_playertimes pt2 WHERE pt2.mapname = pt.mapname AND pt2.runtimepro < pt.runtimepro) as rank
        FROM ck_playertimes pt
        WHERE pt.mapname = ?
      `;
      
      const params: any[] = [mapname];
      
      if (search) {
        query += ` AND (pt.name LIKE ? OR pt.steamid LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`);
      }
      
      query += ` ORDER BY pt.runtimepro ASC LIMIT ? OFFSET ?`;
      params.push(limit, offset);
      
      const [records] = await pool.query<MapRecord[]>(query, params);
      
      // Get total count
      let countQuery = `SELECT COUNT(*) as total FROM ck_playertimes WHERE mapname = ?`;
      const countParams: any[] = [mapname];
      if (search) {
        countQuery += ` AND (name LIKE ? OR steamid LIKE ?)`;
        countParams.push(`%${search}%`, `%${search}%`);
      }
      const [countRows] = await pool.query<RowDataPacket[]>(countQuery, countParams);
      const total = countRows[0].total;

      logger.debug(`[Map] ${mapname} loaded: tier ${map.tier}, ${records.length} records, ${total} total completions`);
      
      return { map, records, total, totalPages: Math.ceil(total / limit) };
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      logger.error(`[Map] Failed to fetch ${mapname}: ${errorMessage}`);
      logger.error(`[Map] Error code: ${error.code || 'N/A'}`);
      return null;
    }
  },
  ['map-profile'],
  { revalidate: 60 }
);

export default async function MapProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ mapname: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { mapname } = await params;
  const decodedMapname = decodeURIComponent(mapname);
  
  // Validate and sanitize map name input
  const validMapname = sanitizeMapName(decodedMapname);
  if (!validMapname) {
    return (
      <div className="text-center py-20 bg-zinc-900 border border-zinc-800 rounded-xl">
        <h1 className="text-2xl font-bold text-white mb-2">Map Not Found</h1>
        <p className="text-zinc-400">The map name contains invalid characters.</p>
        <Link href="/maps" className="inline-block mt-6 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition-colors">
          Back to Maps
        </Link>
      </div>
    );
  }
  
  const sParams = await searchParams;
  // Sanitize search query
  const q = sanitizeSearchQuery(sParams.q);
  // Sanitize page number
  const page = Math.max(1, parseInt(sParams.page || '1', 10) || 1);
  
  const data = await getMapData(validMapname, page, q);
  
  if (!data) {
    return (
      <div className="text-center py-20 bg-zinc-900 border border-zinc-800 rounded-xl">
        <h1 className="text-2xl font-bold text-white mb-2">Map Not Found</h1>
        <p className="text-zinc-400">The map {decodedMapname} could not be found.</p>
        <Link href="/maps" className="inline-block mt-6 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition-colors">
          Back to Maps
        </Link>
      </div>
    );
  }

  const { map, records, total, totalPages } = data;
  const mapImagesUrl = process.env.MAP_IMAGES_URL || 'https://image.gametracker.com/images/maps/160x120/csgo/';

  return (
    <div className="space-y-8">
      {/* Map Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden relative">
        <div className="absolute inset-0 z-0 opacity-20">
          <MapImage
            src={`${mapImagesUrl}${map.mapname}.jpg`}
            alt={map.mapname}
            fill
            className="object-cover blur-sm"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/80 to-transparent" />
        </div>
        
        <div className="relative z-10 p-6 sm:p-10 flex flex-col md:flex-row gap-8 items-center md:items-end">
          <div className="relative h-48 w-full md:w-72 rounded-xl overflow-hidden border-4 border-zinc-800 bg-zinc-800 flex-shrink-0 shadow-2xl">
            <MapImage
              src={`${mapImagesUrl}${map.mapname}.jpg`}
              alt={map.mapname}
              fill
              className="object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
          
          <div className="flex-1 w-full">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              {(() => {
                const tierColor = getTierColor(map.tier);
                return (
                  <span className={`px-3 py-1 ${tierColor.bg} ${tierColor.text} ${tierColor.border} rounded-full text-sm font-bold tracking-wider uppercase`}>
                    Tier {map.tier}
                  </span>
                );
              })()}
              {map.stages > 1 ? (
                <span className="px-3 py-1 bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-full text-sm font-bold tracking-wider uppercase flex items-center gap-1">
                  <Layers className="h-3 w-3" /> {map.stages} Stages
                </span>
              ) : (
                <span className="px-3 py-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-full text-sm font-bold tracking-wider uppercase flex items-center gap-1">
                  <MapIcon className="h-3 w-3" /> Linear
                </span>
              )}
              {map.bonuses > 0 && (
                <span className="px-3 py-1 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-full text-sm font-bold tracking-wider uppercase flex items-center gap-1">
                  <Target className="h-3 w-3" /> {map.bonuses} Bonus{map.bonuses !== 1 ? 'es' : ''}
                </span>
              )}
            </div>
            
            <h1 className="text-4xl sm:text-5xl font-bold text-white mb-2">{map.mapname}</h1>
            <p className="text-zinc-400 text-lg flex items-center gap-2">
              <span className="text-zinc-500">by</span>{' '}
              {(() => {
                const profileUrl = map.mappersteam ? getSteamProfileUrl(map.mappersteam) : null;
                return profileUrl ? (
                  <a
                    href={profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:text-emerald-300 underline transition-colors"
                  >
                    {sanitizePlayerName(map.mapper)}
                  </a>
                ) : (
                  <span>{sanitizePlayerName(map.mapper)}</span>
                );
              })()}
            </p>
          </div>
          
          <div className="bg-zinc-800/80 backdrop-blur-md border border-zinc-700 rounded-xl p-4 text-center min-w-[120px]">
            <Users className="h-6 w-6 text-emerald-400 mx-auto mb-1" />
            <div className="text-2xl font-bold text-white">{total.toLocaleString()}</div>
            <div className="text-xs text-zinc-400 uppercase tracking-wider font-semibold">Completions</div>
          </div>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-500" />
            Leaderboard
          </h2>
          
          <form className="relative w-full sm:w-72">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-zinc-400" />
            </div>
            <input
              type="text"
              name="q"
              defaultValue={q}
              className="block w-full pl-10 pr-3 py-2 border border-zinc-700 rounded-md leading-5 bg-zinc-800 text-zinc-300 placeholder-zinc-400 focus:outline-none focus:bg-zinc-900 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 sm:text-sm transition-colors"
              placeholder="Search players..."
            />
          </form>
        </div>
        
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-800">
            <thead className="bg-zinc-900/50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider w-24">Rank</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">Player</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-zinc-400 uppercase tracking-wider">Time</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-zinc-400 uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody className="bg-zinc-900 divide-y divide-zinc-800">
              {records.map((record, i) => (
                <tr key={`${record.steamid}-${i}`} className="hover:bg-zinc-800/50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center justify-center h-8 w-8 rounded-full font-bold text-sm ${
                      record.rank === 1 ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30' :
                      record.rank === 2 ? 'bg-zinc-300/20 text-zinc-300 border border-zinc-300/30' :
                      record.rank === 3 ? 'bg-amber-700/20 text-amber-600 border border-amber-700/30' :
                      'text-zinc-500'
                    }`}>
                      {record.rank}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Link href={`/players/${record.steamid}`} className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors text-base">
                      {sanitizePlayerName(record.name)}
                    </Link>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <span className="font-mono text-lg font-medium text-zinc-200">
                      {formatTime(record.runtimepro)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-zinc-400">
                    {formatDate(record.date)}
                  </td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-zinc-400">
                    {q ? 'No players found matching your search.' : 'No completions yet.'}
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
              baseUrl={`/maps/${map.mapname}`}
              queryParams={q ? { q } : {}}
            />
          </div>
        )}
      </div>
    </div>
  );
}