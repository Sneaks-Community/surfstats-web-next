import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import Link from 'next/link';
import { Map as MapIcon, Layers, Target, Users } from 'lucide-react';
import { unstable_cache } from 'next/cache';
import { Suspense } from 'react';
import MapImage from '@/components/MapImage';
import MapFilters from '@/components/MapFilters';
import { getTierColor } from '@/lib/tierColors';
import Pagination from '@/components/Pagination';

interface MapData extends RowDataPacket {
  mapname: string;
  tier: number;
  mapper: string;
  completions: number;
  bonuses: number;
  stages: number;
}

interface FilterOptions extends RowDataPacket {
  tier: number;
  count: number;
}

const getMaps = unstable_cache(
  async (
    page: number,
    search: string,
    type: string,
    tiers: number[],
    mapper: string,
    bonuses: string
  ) => {
    try {
      const limit = 20;
      const offset = (page - 1) * limit;
      
      let query = `
        SELECT
          m.mapname, m.tier, m.mapper,
          (SELECT COUNT(*) FROM ck_playertimes pt WHERE pt.mapname = m.mapname) as completions,
          (SELECT COUNT(DISTINCT zonegroup) FROM ck_zones z WHERE z.mapname = m.mapname AND z.zonegroup > 0) as bonuses,
          (SELECT COUNT(*) + 1 FROM ck_zones z WHERE z.mapname = m.mapname AND z.zonetype = 3) as stages
        FROM ck_maptier m
      `;
      
      const params: any[] = [];
      const conditions: string[] = [];
      
      // Filter to only show maps that have player times
      conditions.push(`EXISTS (SELECT 1 FROM ck_playertimes pt WHERE pt.mapname = m.mapname)`);
      
      if (search) {
        conditions.push(`m.mapname LIKE ?`);
        params.push(`%${search}%`);
      }
      
      if (type === 'linear') {
        conditions.push(`(SELECT COUNT(*) FROM ck_zones z WHERE z.mapname = m.mapname AND z.zonetype = 3) = 0`);
      } else if (type === 'staged') {
        conditions.push(`(SELECT COUNT(*) FROM ck_zones z WHERE z.mapname = m.mapname AND z.zonetype = 3) > 0`);
      }
      
      if (tiers.length > 0) {
        const placeholders = tiers.map(() => '?').join(', ');
        conditions.push(`m.tier IN (${placeholders})`);
        params.push(...tiers);
      }
      
      if (mapper) {
        conditions.push(`m.mapper LIKE ?`);
        params.push(`%${mapper}%`);
      }
      
      if (bonuses !== 'all') {
        if (bonuses === '0') {
          conditions.push(`(SELECT COUNT(DISTINCT zonegroup) FROM ck_zones z WHERE z.mapname = m.mapname AND z.zonegroup > 0) = 0`);
        } else if (bonuses === '4+') {
          conditions.push(`(SELECT COUNT(DISTINCT zonegroup) FROM ck_zones z WHERE z.mapname = m.mapname AND z.zonegroup > 0) >= 4`);
        } else {
          conditions.push(`(SELECT COUNT(DISTINCT zonegroup) FROM ck_zones z WHERE z.mapname = m.mapname AND z.zonegroup > 0) = ?`);
          params.push(parseInt(bonuses));
        }
      }
      
      if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(' AND ');
      }
      
      query += ` ORDER BY m.mapname ASC LIMIT ? OFFSET ?`;
      params.push(limit, offset);
      
      const [rows] = await pool.query<MapData[]>(query, params);
      
      // Get total count for pagination
      let countQuery = `SELECT COUNT(*) as total FROM ck_maptier m WHERE EXISTS (SELECT 1 FROM ck_playertimes pt WHERE pt.mapname = m.mapname)`;
      const countConditions = conditions.slice(1); // Remove the EXISTS condition for count query
      if (countConditions.length > 0) {
        countQuery += ` AND ` + countConditions.join(' AND ');
      }
      const [countRows] = await pool.query<RowDataPacket[]>(countQuery, params.slice(0, -2));
      const total = countRows[0].total;
      
      return { maps: rows, total, totalPages: Math.ceil(total / limit) };
    } catch (error) {
      console.error('Error fetching maps:', error);
      return { maps: [], total: 0, totalPages: 0 };
    }
  },
  ['maps-list'],
  { revalidate: 300 } // Cache for 5 minutes
);

const getFilterOptions = unstable_cache(
  async () => {
    try {
      // Get tier distribution
      const tierQuery = `
        SELECT m.tier, COUNT(*) as count
        FROM ck_maptier m
        WHERE EXISTS (SELECT 1 FROM ck_playertimes pt WHERE pt.mapname = m.mapname)
        GROUP BY m.tier
        ORDER BY m.tier ASC
      `;
      const [tierRows] = await pool.query<FilterOptions[]>(tierQuery);
      
      return { tiers: tierRows };
    } catch (error) {
      console.error('Error fetching filter options:', error);
      return { tiers: [] };
    }
  },
  ['maps-filter-options'],
  { revalidate: 300 }
);

export default async function MapsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    page?: string | string[];
    type?: string | string[];
    tiers?: string | string[];
    mapper?: string | string[];
    bonuses?: string | string[];
  }>;
}) {
  const params = await searchParams;
  // Helper to handle string | string[] from searchParams (returns first value)
  const getParam = (value: string | string[] | undefined, defaultValue: string = ''): string => {
    if (Array.isArray(value)) return value[0] || defaultValue;
    return value || defaultValue;
  };
  
  // Helper to get all values from string | string[] (for multi-select like tiers)
  const getParamArray = (value: string | string[] | undefined): string[] => {
    if (Array.isArray(value)) return value;
    if (value) return [value];
    return [];
  };
  
  const q = getParam(params.q);
  const page = parseInt(getParam(params.page, '1'), 10);
  const type = getParam(params.type, 'all');
  // Handle tiers from URL - can be comma-separated or multiple params
  const tiersParams = getParamArray(params.tiers);
  const tiers = tiersParams.flatMap(t => t.split(',').map(tier => parseInt(tier.trim())).filter(tier => !isNaN(tier)));
  const mapper = getParam(params.mapper);
  const bonuses = getParam(params.bonuses, 'all');
  
  const { maps, total, totalPages } = await getMaps(page, q, type, tiers, mapper, bonuses);
  const filterOptions = await getFilterOptions();
  const mapImagesUrl = process.env.MAP_IMAGES_URL || 'https://image.gametracker.com/images/maps/160x120/csgo/';


  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white">Maps</h1>
            <p className="text-zinc-400">Browse {total.toLocaleString()} surf maps</p>
          </div>
        </div>
        
        {/* Filter Panel */}
        <Suspense fallback={<div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 h-32 animate-pulse" />}>
          <MapFilters tierOptions={filterOptions.tiers} />
        </Suspense>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {maps.map((map) => {
          const tierColor = getTierColor(map.tier);
          return (
            <Link href={`/maps/${map.mapname}`} key={map.mapname} className="group block bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden hover:border-emerald-500/50 transition-colors">
              <div className="relative h-48 bg-zinc-800 w-full overflow-hidden">
                <MapImage
                  src={`${mapImagesUrl}${map.mapname}.jpg`}
                  alt={map.mapname}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-300"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/60 to-transparent" />
                <div className="absolute bottom-2 left-3 right-3">
                  <h3 className="text-lg font-bold text-white truncate">{map.mapname}</h3>
                  <span className={`inline-block mt-1 px-2 py-0.5 bg-zinc-800/80 backdrop-blur-sm text-xs font-semibold rounded-md border border-zinc-700 ${tierColor.text}`}>
                    Tier {map.tier}
                  </span>
                </div>
              <div className="absolute top-2 right-2 flex items-center gap-3 px-2 py-1 bg-zinc-900/80 backdrop-blur-sm rounded-md text-xs text-zinc-300">
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {map.completions.toLocaleString()}
                </span>
                <span className="flex items-center gap-1">
                  <Target className="h-3 w-3" />
                  {map.bonuses || 0}
                </span>
                <span className="flex items-center gap-1">
                  <Layers className="h-3 w-3" />
                  {map.stages > 1 ? map.stages : 'Linear'}
                </span>
              </div>
              </div>
            </Link>
          );
        })}
      </div>
      
      {maps.length === 0 && (
        <div className="text-center py-12 bg-zinc-900 border border-zinc-800 rounded-xl">
          <MapIcon className="h-12 w-12 text-zinc-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-white">No maps found</h3>
          <p className="text-zinc-400 mt-1">Try adjusting your search or filters.</p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          baseUrl="/maps"
          queryParams={{
            ...(q && { q }),
            ...(type !== 'all' && { type }),
            ...(tiers.length > 0 && { tiers: tiers.join(',') }),
            ...(mapper && { mapper }),
            ...(bonuses !== 'all' && { bonuses }),
          }}
        />
      )}
    </div>
  );
}