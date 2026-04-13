import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import { getSteamProfileUrl } from '@/lib/steam';
import Link from 'next/link';
import { Map as MapIcon, Users, Layers, Target, Download } from 'lucide-react';
import MapImage from '@/components/MapImage';
import { sanitizeMapName, sanitizePlayerName } from '@/lib/sanitize';
import logger from '@/lib/logger';
import MapRecordsTabs from './components/MapRecordsTabs';
import TierBadge from '@/components/TierBadge';
import MapChartGrid from './components/charts/MapChartGrid';
import { getMapMetadata } from '@/lib/map-cache';
import { unstable_cache } from 'next/cache';
import { withTimeout } from '@/lib/timeout';

// Default page size - keeps cache entry under 2MB (each record ~200 bytes, 100 records ~20KB)
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const QUERY_TIMEOUT_MS = 30000; // 30 seconds - prevents indefinite query hanging

interface MapRecord {
  steamid: string;
  name: string;
  runtimepro: number;
  date: string;
  rank: number;
  wr_time: number | null;
  startspeed: number;
}

interface BonusRecord {
  steamid: string;
  name: string;
  zonegroup: number;
  runtime: number;
  date: string;
  rank: number;
  wr_time: number | null;
  startspeed: number;
}

interface StageRecord {
  steamid: string;
  name: string;
  stage: number;
  runtime: number;
  date: string;
  rank: number;
  wr_time: number | null;
  startspeed: number;
}

interface RecordCounts {
  leaderboardTotal: number;
  bonusesTotal: number;
  stagesTotal: number;
}

interface MapRecordsResult {
  leaderboard: MapRecord[];
  bonuses: BonusRecord[];
  stages: StageRecord[];
  counts: RecordCounts;
  wr_time: number | null;
}

// Cached function to fetch map records (leaderboard, counts, WR time)
const getMapRecords = unstable_cache(
  async (mapname: string, page: number = 1, pageSize: number = DEFAULT_PAGE_SIZE): Promise<MapRecordsResult> => {
    // Enforce limits to prevent cache bloat
    const safePageSize = Math.min(Math.max(1, pageSize), MAX_PAGE_SIZE);
    const safePage = Math.max(1, page);
    const offset = (safePage - 1) * safePageSize;

    logger.debug(`[Map] Fetching records for: ${mapname} (page ${safePage}, size ${safePageSize})`);

    try {
      // First, get the total counts for all record types in a single query
      const [countsRows] = await withTimeout(
        pool.query<RowDataPacket[]>(`
          SELECT
            (SELECT COUNT(*) FROM ck_playertimes WHERE mapname = ?) as leaderboardTotal,
            (SELECT COUNT(*) FROM ck_bonus WHERE mapname = ?) as bonusesTotal,
            (SELECT COUNT(*) FROM ck_stages WHERE \`map\` = ?) as stagesTotal
        `, [mapname, mapname, mapname]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      const counts: RecordCounts = {
        leaderboardTotal: countsRows[0]?.leaderboardTotal || 0,
        bonusesTotal: countsRows[0]?.bonusesTotal || 0,
        stagesTotal: countsRows[0]?.stagesTotal || 0,
      };

      // Use window functions for efficient rank calculation - O(n) instead of O(n²)
      // This query calculates ranks using ROW_NUMBER() which is much faster than correlated subqueries
      
      // Get WR time for the map (needed for all records)
      const [wrTimeRows] = await withTimeout(
        pool.query<RowDataPacket[]>(`
          SELECT MIN(runtimepro) as wr_time FROM ck_playertimes WHERE mapname = ?
        `, [mapname]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );
      const wr_time = wrTimeRows[0]?.wr_time || null;

      // Get leaderboard records with pagination and window function for rank
      const [leaderboardRows] = await withTimeout(
        pool.query<RowDataPacket[] & MapRecord[]>(`
          SELECT
            steamid, name, runtimepro, date, startspeed,
            ROW_NUMBER() OVER (ORDER BY runtimepro ASC) as rank,
            ? as wr_time
          FROM ck_playertimes
          WHERE mapname = ?
          ORDER BY runtimepro ASC
          LIMIT ? OFFSET ?
        `, [wr_time, mapname, safePageSize, offset]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      // Bonuses are fetched client-side via API to keep server payload small
      const bonusRows: BonusRecord[] = [];

      // Stages are fetched client-side via API to avoid huge payloads
      // (maps can have 300K+ stage records which exceeds 2MB cache limit)
      const stageRows: StageRecord[] = [];

      logger.debug(`[Map] ${mapname} loaded: ${leaderboardRows.length}/${counts.leaderboardTotal} leaderboard records, ${bonusRows.length} bonus records, ${stageRows.length} stage records`);

      return { leaderboard: leaderboardRows, bonuses: bonusRows, stages: stageRows, counts, wr_time };
    } catch (error: any) {
      // Handle timeout specifically
      if (error.message === 'Query timeout exceeded') {
        logger.error(`[Map] Query timeout for ${mapname} after ${QUERY_TIMEOUT_MS / 1000} seconds`);
        return { leaderboard: [], bonuses: [], stages: [], counts: { leaderboardTotal: 0, bonusesTotal: 0, stagesTotal: 0 }, wr_time: null };
      }
      
      const errorMessage = error.message || 'Unknown error';
      logger.error(`[Map] Failed to fetch records for ${mapname}: ${errorMessage}`);
      logger.error(`[Map] Error code: ${error.code || 'N/A'}`);
      return { leaderboard: [], bonuses: [], stages: [], counts: { leaderboardTotal: 0, bonusesTotal: 0, stagesTotal: 0 }, wr_time: null };
    }
  },
  [], // Empty keyParts array - Next.js uses function arguments as cache key
  { revalidate: 300 } // Revalidate cache every 5 minutes
);

export async function generateMetadata({ params }: { params: Promise<{ mapname: string }> }) {
  const { mapname } = await params;
  const decodedMapname = decodeURIComponent(mapname);
  const validMapname = sanitizeMapName(decodedMapname);
  
  if (!validMapname) {
    return { title: 'Map Not Found' };
  }
  
  const map = await getMapMetadata(validMapname);
  
  if (!map) {
    return { title: 'Map Not Found' };
  }
  
  return {
    title: map.mapname,
  };
}

export default async function MapProfilePage({
  params,
}: {
  params: Promise<{ mapname: string }>;
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
  
  const [map, recordsData] = await Promise.all([
    getMapMetadata(validMapname),
    getMapRecords(validMapname, 1, DEFAULT_PAGE_SIZE)
  ]);
  
  logger.debug(`[Map Page] Map data for ${validMapname}: stages=${map?.stages}, checkpoints=${map?.checkpoints}`);
  
  if (!map) {
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

  const { leaderboard, bonuses, stages, counts, wr_time } = recordsData;
  const total = counts.leaderboardTotal;
  const mapImagesUrl = process.env.MAP_IMAGES_URL || 'https://image.gametracker.com/images/maps/160x120/csgo/';

  return (
    <div className="space-y-4">
      {/* Map Header */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden relative">
        <div className="absolute inset-0 z-0 opacity-60">
          <MapImage
            src={`${mapImagesUrl}${map.mapname}.jpg`}
            alt={map.mapname}
            fill
            className="object-cover blur-sm"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/80 to-transparent" />
        </div>
        
        <div className="relative z-10 p-4 sm:p-6 flex flex-col md:flex-row gap-3 items-center md:items-end">
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
              <TierBadge tier={map.tier} variant="full" className="rounded-full" />
              {map.stages > 1 ? (
                <span className="px-3 py-1 bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-full text-sm font-bold tracking-wider uppercase flex items-center gap-1">
                  <Layers className="h-3 w-3" /> {map.stages} Stages
                </span>
              ) : map.checkpoints > 0 ? (
                <span className="px-3 py-1 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-full text-sm font-bold tracking-wider uppercase flex items-center gap-1">
                  <MapIcon className="h-3 w-3" /> {map.checkpoints} Checkpoints
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

      {/* Chart Grid */}
      <MapChartGrid mapname={validMapname} />

      {/* Leaderboard with Tabs */}
      <MapRecordsTabs
        records={leaderboard}
        totalRecords={total}
        bonusRecords={bonuses}
        stageRecords={stages}
        mapname={map.mapname}
        numBonuses={map.bonuses}
        numStages={map.stages}
        wr_time={wr_time}
      />
    </div>
  );
}
