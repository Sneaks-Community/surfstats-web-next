import { getSteamProfileUrl } from '@/lib/steam';
import Link from 'next/link';
import { Map as MapIcon, Users, Layers, Target, Download } from 'lucide-react';
import MapImage from '@/components/MapImage';
import { validateMapName, validatePlayerName } from '@/lib/validators';
import { mapImageUrl } from '@/lib/utils';
import logger from '@/lib/logger';
import MapRecordsTabs from './components/MapRecordsTabs';
import TierBadge from '@/components/TierBadge';
import MapChartGrid from './components/charts/MapChartGrid';
import { getMapMetadataFromCache } from '@/lib/valkey-map-cache';
import { getMapRecordsFromCache } from '@/lib/valkey-map-records-cache';
import { getMapChartDataFromCache } from '@/lib/valkey-map-stats-cache';

// Default page size - keeps cache entry under 2MB (each record ~200 bytes, 100 records ~20KB)
const DEFAULT_PAGE_SIZE = 100;

export async function generateMetadata({ params }: { params: Promise<{ mapname: string }> }) {
  const { mapname } = await params;
  const decodedMapname = decodeURIComponent(mapname);
  const validMapname = validateMapName(decodedMapname);
  
  if (!validMapname) {
    return { title: 'Map Not Found' };
  }
  
  const map = await getMapMetadataFromCache(validMapname);
  
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
  const validMapname = validateMapName(decodedMapname);
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
  
  const [map, recordsData, chartData] = await Promise.all([
    getMapMetadataFromCache(validMapname),
    getMapRecordsFromCache(validMapname, 1, DEFAULT_PAGE_SIZE),
    getMapChartDataFromCache(validMapname)
  ]);
  
  logger.debug(`[Map Page] Map data for ${validMapname}: stages=${map?.stages}, checkpoints=${map?.checkpoints}`);
  
  if (!map) {
    return (
      <div className="text-center py-20 bg-surface border border-border rounded-xl">
        <h1 className="text-2xl font-bold text-text mb-2">Map Not Found</h1>
        <p className="text-text-muted">The map "{decodedMapname}" was not found in the database.</p>
        <Link href="/maps" className="inline-block mt-6 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-md transition-colors">
          Back to Maps
        </Link>
      </div>
    );
  }
  
  const leaderboard = recordsData.leaderboard;
  const total = recordsData.counts.leaderboardTotal;

  const mapImagesUrl = process.env.MAP_IMAGES_URL || 'https://image.gametracker.com/images/maps/160x120/csgo/';

  return (
    <div className="space-y-4">
      {/* Map Header */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden relative">
        <div className="absolute inset-0 z-0 opacity-60">
          <MapImage
            src={mapImageUrl(mapImagesUrl, map.mapname)}
            alt={map.mapname}
            unoptimized
            fill
            className="object-cover blur-sm"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/80 to-transparent" />
        </div>
        
        <div className="relative z-10 p-4 sm:p-6 flex flex-col md:flex-row gap-3 items-center md:items-end">
          <div className="relative h-48 w-full md:w-72 rounded-xl overflow-hidden border-4 border-border bg-surface-hover flex-shrink-0 shadow-2xl">
            <MapImage
              src={mapImageUrl(mapImagesUrl, map.mapname)}
              alt={map.mapname}
              unoptimized
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
                    {validatePlayerName(map.mapper)}
                  </a>
                ) : (
                  <span>{validatePlayerName(map.mapper)}</span>
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
      <MapChartGrid data={chartData} />

      {/* Leaderboard with Tabs */}
      <MapRecordsTabs
        records={leaderboard}
        totalRecords={total}
        mapname={map.mapname}
        numBonuses={map.bonuses}
        numStages={map.stages}
      />
    </div>
  );
}
