import { Suspense } from 'react';
import { getSteamProfileUrl } from '@/lib/steam';
import { notFound } from 'next/navigation';
import { Skeleton } from '@/components/Skeleton';
import { Map as MapIcon, Users, Layers, Target, Download } from 'lucide-react';
import MapImage from '@/components/MapImage';
import { validateMapName, validatePlayerName } from '@/lib/validators';
import { mapImageUrl, getMapImagesUrl } from '@/lib/utils';
import logger from '@/lib/logger';
import MapRecordsTabs from './components/MapRecordsTabs';
import PageTabs from '@/components/PageTabs';
import TierBadge from '@/components/TierBadge';
import MapChartGrid from './components/charts/MapChartGrid';
import { isStagedMap } from '@/lib/map-cache';
import { getMapMetadataFromCache } from '@/lib/map-cache';
import { getMapChartDataFromCache } from '@/lib/map-stats-cache';

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

  const siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'SurfStats';
  const description =
    `Leaderboards, world records, and completion stats for the CS:GO surf map ${map.mapname} (Tier ${map.tier})` +
    (map.wr_holder ? `. Current world record held by ${map.wr_holder}.` : '.');
  const imagesBaseUrl = getMapImagesUrl();

  return {
    title: map.mapname,
    description,
    openGraph: {
      type: 'website',
      siteName,
      title: `${map.mapname} - ${siteName}`,
      description,
      images: [{ url: mapImageUrl(imagesBaseUrl, map.mapname) }],
    },
  };
}

/**
 * Seven cached aggregates, all below the fold. Behind a Suspense boundary so the
 * header and the leaderboard stream first instead of waiting on them; on a cold
 * key that wait is seconds, not milliseconds.
 */
async function ChartGrid({ mapname }: { mapname: string }) {
  return <MapChartGrid data={await getMapChartDataFromCache(mapname)} />;
}

const ChartGridSkeleton = () => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
    {Array.from({ length: 4 }).map((_, i) => (
      <Skeleton key={i} className="rounded-xl h-72" />
    ))}
  </div>
);

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
    notFound();
  }

  const map = await getMapMetadataFromCache(validMapname);

  logger.debug(`[Map Page] Map data for ${validMapname}: stages=${map?.stages}, checkpoints=${map?.checkpoints}`);

  if (!map) {
    notFound();
  }

  // Cheap cached count; avoids the expensive records query on page render.
  const total = map.completions;

  const mapImagesUrl = getMapImagesUrl();

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
              {isStagedMap(map) ? (
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

      <PageTabs
        overview={
          <Suspense fallback={<ChartGridSkeleton />}>
            <ChartGrid mapname={validMapname} />
          </Suspense>
        }
        times={
          <MapRecordsTabs
            totalRecords={total}
            mapname={map.mapname}
            numBonuses={map.bonuses}
            numStages={map.stages}
          />
        }
      />
    </div>
  );
}
