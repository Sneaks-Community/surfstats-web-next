import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import { getSteamProfileUrl } from '@/lib/steam';
import Link from 'next/link';
import { Search, Map as MapIcon, Users, Trophy, Layers, Target, Download } from 'lucide-react';
import MapImage from '@/components/MapImage';
import Pagination from '@/components/Pagination';
import { unstable_cache } from 'next/cache';
import { getTierColor } from '@/lib/tierColors';
import { formatTime, formatDate } from '@/lib/utils';
import { sanitizeMapName, sanitizeSearchQuery, sanitizePlayerName } from '@/lib/sanitize';
import logger from '@/lib/logger';
import type { Metadata } from 'next';

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

export async function generateMetadata({ params }: { params: Promise<{ mapname: string }> }) {
  const { mapname } = await params;
  const decodedMapname = decodeURIComponent(mapname);
  const validMapname = sanitizeMapName(decodedMapname);
  
  if (!validMapname) {
    return { title: 'Map Not Found' };
  }
  
  const data = await getMapData(validMapname, 1, '');
  
  if (!data) {
    return { title: 'Map Not Found' };
  }
  
  return {
    title: data.map.mapname,
  };
}

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
      <div className="text-center py-20 bg-surface border border-border rounded-xl">
        <h1 className="text-2xl font-bold text-text mb-2">Map Not Found</h1>
        <p className="text-text-muted">The map name contains invalid characters.</p>
        <Link href="/maps" className="inline-block mt-6 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-md transition-colors">
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
      <div className="text-center py-20 bg-surface border border-border rounded-xl">
        <h1 className="text-2xl font-bold text-text mb-2">Map Not Found</h1>
        <p className="text-text-muted">The map {decodedMapname} could not be found.</p>
        <Link href="/maps" className="inline-block mt-6 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-md transition-colors">
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
      <div className="bg-surface border border-border rounded-xl overflow-hidden relative">
        <div className="absolute inset-0 z-0 opacity-20">
          <MapImage
            src={`${mapImagesUrl}${map.mapname}.jpg`}
            alt={map.mapname}
            fill
            className="object-cover blur-sm"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/80 to-transparent" />
        </div>
        
        <div className="relative z-10 p-6 sm:p-10 flex flex-col md:flex-row gap-8 items-center md:items-end">
          <div className="relative h-48 w-full md:w-72 rounded-xl overflow-hidden border-4 border-border bg-surface-hover flex-shrink-0 shadow-2xl">
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
            
            <h1 className="text-4xl sm:text-5xl font-bold text-text mb-2 flex items-center gap-3">
              {map.mapname}
              {process.env.NEXT_PUBLIC_MAP_DOWNLOAD_URL_PREFIX && process.env.NEXT_PUBLIC_MAP_DOWNLOAD_URL_SUFFIX && (
                <a
                  href={`${process.env.NEXT_PUBLIC_MAP_DOWNLOAD_URL_PREFIX}${map.mapname}${process.env.NEXT_PUBLIC_MAP_DOWNLOAD_URL_SUFFIX}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary-hover transition-colors inline-flex items-center"
                  title="Download map"
                >
                  <Download className="h-6 w-6" />
                </a>
              )}
            </h1>
            <p className="text-text-muted text-lg flex items-center gap-2">
              <span className="text-text-placeholder">by</span>{' '}
              {(() => {
                const profileUrl = map.mappersteam ? getSteamProfileUrl(map.mappersteam) : null;
                return profileUrl ? (
                  <a
                    href={profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:text-primary transition-colors underline"
                  >
                    {sanitizePlayerName(map.mapper)}
                  </a>
                ) : (
                  <span>{sanitizePlayerName(map.mapper)}</span>
                );
              })()}
            </p>
          </div>
          
          <div className="bg-surface-hover/80 backdrop-blur-md border border-border rounded-xl p-4 text-center min-w-[120px]">
            <Users className="h-6 w-6 text-primary mx-auto mb-1" />
            <div className="text-2xl font-bold text-text">{total.toLocaleString()}</div>
            <div className="text-xs text-text-muted uppercase tracking-wider font-semibold">Completions</div>
          </div>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-surface/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-xl font-semibold text-text flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-500" />
            Leaderboard
          </h2>
          
          <form className="relative w-full sm:w-72">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-text-placeholder" />
            </div>
            <input
              type="text"
              name="q"
              defaultValue={q}
              className="block w-full pl-10 pr-3 py-2 border border-border rounded-md leading-5 bg-background-secondary text-text placeholder-text-placeholder focus:outline-none focus:bg-surface focus:border-border-focus focus:ring-1 focus:ring-border-focus sm:text-sm transition-colors"
              placeholder="Search players..."
            />
          </form>
        </div>
        
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-surface/50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider w-24">Rank</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Player</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wider">Time</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody className="bg-surface divide-y divide-border">
              {records.map((record, i) => (
                <tr key={`${record.steamid}-${i}`} className="hover:bg-surface-hover/50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center justify-center h-8 w-8 rounded-full font-bold text-sm ${
                      record.rank === 1 ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30' :
                      record.rank === 2 ? 'bg-zinc-300/20 text-zinc-300 border border-zinc-300/30' :
                      record.rank === 3 ? 'bg-amber-700/20 text-amber-600 border border-amber-700/30' :
                      'text-text-placeholder'
                    }`}>
                      {record.rank}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Link href={`/players/${record.steamid}`} className="text-primary hover:text-primary font-medium transition-colors text-base">
                      {sanitizePlayerName(record.name)}
                    </Link>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <span className="font-mono text-lg font-medium text-text">
                      {formatTime(record.runtimepro)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-text-muted">
                    {formatDate(record.date)}
                  </td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-text-muted">
                    {q ? 'No players found matching your search.' : 'No completions yet.'}
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
              baseUrl={`/maps/${map.mapname}`}
              queryParams={q ? { q } : {}}
            />
          </div>
        )}
      </div>
    </div>
  );
}