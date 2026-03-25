import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import { getSteamProfileUrl } from '@/lib/steam';
import Link from 'next/link';
import { Map as MapIcon, Users, Layers, Target, Download } from 'lucide-react';
import MapImage from '@/components/MapImage';
import { unstable_cache } from 'next/cache';
import { getTierColor } from '@/lib/tierColors';
import { sanitizeMapName, sanitizePlayerName } from '@/lib/sanitize';
import logger from '@/lib/logger';
import type { Metadata } from 'next';
import MapRecordsTabs from './components/MapRecordsTabs';

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
  wr_time: number | null;
  startspeed: number;
}

interface BonusRecord extends RowDataPacket {
  steamid: string;
  name: string;
  zonegroup: number;
  runtime: number;
  date: string;
  rank: number;
  wr_time: number | null;
  startspeed: number;
}

interface StageRecord extends RowDataPacket {
  steamid: string;
  name: string;
  stage: number;
  runtime: number;
  date: string;
  rank: number;
  wr_time: number | null;
  startspeed: number;
}

const getMapData = unstable_cache(
  async (mapname: string) => {
    logger.debug(`[Map] Fetching map info for: ${mapname}`);
    
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
      
      return mapRows[0];
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      logger.error(`[Map] Failed to fetch map info for ${mapname}: ${errorMessage}`);
      logger.error(`[Map] Error code: ${error.code || 'N/A'}`);
      return null;
    }
  },
  ['map-info'],
  { revalidate: 60 }
);

const getMapRecords = unstable_cache(
  async (mapname: string) => {
    logger.debug(`[Map] Fetching all records for: ${mapname}`);
    
    try {
      // Get all leaderboard records with WR time
      const [leaderboardRows] = await pool.query<MapRecord[]>(`
        SELECT
          pt.steamid, pt.name, pt.runtimepro, pt.date, pt.startspeed,
          (SELECT COUNT(*) + 1 FROM ck_playertimes pt2 WHERE pt2.mapname = pt.mapname AND pt2.runtimepro < pt.runtimepro) as rank,
          (SELECT MIN(runtimepro) FROM ck_playertimes WHERE mapname = pt.mapname) as wr_time
        FROM ck_playertimes pt
        WHERE pt.mapname = ?
        ORDER BY pt.runtimepro ASC
      `, [mapname]);

      // Get all bonus records with WR time
      const [bonusRows] = await pool.query<BonusRecord[]>(`
        SELECT
          b.steamid, b.name, b.zonegroup, b.runtime, b.date, b.startspeed,
          (SELECT COUNT(*) + 1 FROM ck_bonus b2
           WHERE b2.mapname = b.mapname AND b2.zonegroup = b.zonegroup AND b2.runtime < b.runtime) as rank,
          (SELECT MIN(runtime) FROM ck_bonus WHERE mapname = b.mapname AND zonegroup = b.zonegroup) as wr_time
        FROM ck_bonus b
        WHERE b.mapname = ?
        ORDER BY b.zonegroup ASC, b.runtime ASC
      `, [mapname]);

      // Get all stage records with WR time
      const [stageRows] = await pool.query<StageRecord[]>(`
        SELECT
          s.steamid, pr.name, s.stage, s.runtime, s.date, s.startspeed,
          (SELECT COUNT(*) + 1 FROM ck_stages s2
           WHERE s2.map = s.map AND s2.stage = s.stage AND s2.runtime < s.runtime) as rank,
          (SELECT MIN(runtime) FROM ck_stages WHERE map = s.map AND stage = s.stage) as wr_time
        FROM ck_stages s
        LEFT JOIN ck_playerrank pr ON s.steamid = pr.steamid
        WHERE s.map = ?
        ORDER BY s.stage ASC, s.runtime ASC
      `, [mapname]);

      logger.debug(`[Map] ${mapname} loaded: ${leaderboardRows.length} leaderboard records, ${bonusRows.length} bonus records, ${stageRows.length} stage records`);
      
      return { leaderboard: leaderboardRows, bonuses: bonusRows, stages: stageRows };
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      logger.error(`[Map] Failed to fetch records for ${mapname}: ${errorMessage}`);
      logger.error(`[Map] Error code: ${error.code || 'N/A'}`);
      return { leaderboard: [], bonuses: [], stages: [] };
    }
  },
  ['map-records'],
  { revalidate: 60 }
);

export async function generateMetadata({ params }: { params: Promise<{ mapname: string }> }) {
  const { mapname } = await params;
  const decodedMapname = decodeURIComponent(mapname);
  const validMapname = sanitizeMapName(decodedMapname);
  
  if (!validMapname) {
    return { title: 'Map Not Found' };
  }
  
  const map = await getMapData(validMapname);
  
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
    getMapData(validMapname),
    getMapRecords(validMapname)
  ]);
  
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

  const { leaderboard, bonuses, stages } = recordsData;
  const total = leaderboard.length;
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
                    Tier {map.tier}</span>
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

      {/* Leaderboard with Tabs */}
      <MapRecordsTabs
        records={leaderboard}
        totalRecords={total}
        bonusRecords={bonuses}
        stageRecords={stages}
        mapname={map.mapname}
        numBonuses={map.bonuses}
        numStages={map.stages}
      />
    </div>
  );
}
