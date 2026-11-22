import { Suspense } from 'react';
import { getSteamProfileUrl } from '@/lib/steam';
import { notFound, permanentRedirect } from 'next/navigation';
import { Skeleton } from '@/components/Skeleton';
import { Map as MapIcon, Users, Layers, Target, Download, Trophy, Medal, Award, Timer, Clock, ChevronRight, ChevronDown, User, type LucideIcon } from 'lucide-react';
import Link from '@/components/Link';
import MapImage from '@/components/MapImage';
import StatTile from '@/components/StatTile';
import { validateMapName, validatePlayerName } from '@/lib/validators';
import { mapImageUrl, getMapImagesUrl, isStagedMap, formatTime, relatedMaps, SITE_NAME } from '@/lib/utils';
import logger from '@/lib/logger';
import MapRecordsTabs from './components/MapRecordsTabs';
import PageTabs from '@/components/PageTabs';
import TierBadge from '@/components/TierBadge';
import MapChartGrid from './components/charts/MapChartGrid';
import { findMapNameIgnoringCase, getAllMapMetadataFromCache, getMapMetadataFromCache, type MapMetadata } from '@/lib/map-cache';
import { getMapChartDataFromCache, getPercentileTimesFromCache } from '@/lib/map-stats-cache';

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

  const staged = isStagedMap(map);
  const extras = [staged && 'stage', map.bonuses > 0 && 'bonus'].filter(Boolean).join(' and ');
  const description = [
    map.wr_time != null &&
      `${map.mapname} world record: ${formatTime(map.wr_time)}${map.wr_holder ? ` by ${validatePlayerName(map.wr_holder)}` : ''}.`,
    `Tier ${map.tier} ${staged ? `staged CS:GO surf map (${map.stages} stages)` : 'linear CS:GO surf map'} by ${validatePlayerName(map.mapper)}, ${map.completions.toLocaleString()} completions.`,
    `Full leaderboard${extras && ` with ${extras} times`}.`,
  ].filter(Boolean).join(' ');
  const title = `${map.mapname} World Record & Leaderboard (Tier ${map.tier})`;
  const socialTitle = `${title} - ${SITE_NAME}`;
  const path = `/maps/${map.mapname}`;
  const image = mapImageUrl(getMapImagesUrl(), map.mapname);

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      title: socialTitle,
      description,
      url: path,
      images: [{ url: image }],
    },
    twitter: { card: 'summary_large_image', title: socialTitle, description, images: [image] },
  };
}

/**
 * Seven cached aggregates, all below the fold, so Suspense lets the header and leaderboard
 * stream first instead of waiting on them (seconds on a cold key).
 */
async function ChartGrid({ mapname }: { mapname: string }) {
  return <MapChartGrid data={await getMapChartDataFromCache(mapname)} />;
}

function RelatedMapList({ title, icon: Icon, maps }: {
  title: string;
  icon: LucideIcon;
  maps: MapMetadata[];
}) {
  if (maps.length === 0) return null;
  // Native <details>: collapsed, but the links stay in the server HTML for crawlers.
  return (
    <details className="group/related">
      <summary className="flex items-center gap-2 min-h-11 border-b border-border pb-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <Icon className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold text-text">{title}</h2>
        <ChevronDown className="ml-auto h-5 w-5 text-text-muted transition-transform group-open/related:rotate-180" />
      </summary>
      <div className="mt-3 bg-surface border border-border rounded-xl overflow-hidden divide-y divide-border">
        {maps.map((m) => (
          <Link
            key={m.mapname}
            href={`/maps/${m.mapname}`}
            className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-hover/50 transition-colors group"
          >
            <span className="font-medium text-text group-hover:text-primary transition-colors truncate">{m.mapname}</span>
            <span className="flex items-center gap-3 shrink-0 text-xs text-text-muted">
              Tier {m.tier}
              <ChevronRight className="h-4 w-4 text-text-placeholder group-hover:text-text-muted transition-colors" />
            </span>
          </Link>
        ))}
      </div>
    </details>
  );
}

const ChartGridSkeleton = () => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
    {Array.from({ length: 4 }).map((_, i) => (
      <Skeleton key={i} className="rounded-xl h-72" />
    ))}
  </div>
);

/** No `loading.tsx` on this route or above it: its fallback would stream the page into a hidden
 * div that non-JS crawlers may skip, and fix the status at 200 before notFound() can run. */
export default async function MapProfilePage({
  params,
}: {
  params: Promise<{ mapname: string }>;
}) {
  const { mapname } = await params;
  const decodedMapname = decodeURIComponent(mapname);
  
  const validMapname = validateMapName(decodedMapname);
  if (!validMapname) {
    notFound();
  }

  const map = await getMapMetadataFromCache(validMapname);

  logger.debug(`[Map Page] Map data for ${validMapname}: stages=${map?.stages}, checkpoints=${map?.checkpoints}`);

  if (!map) {
    // 308 to the stored spelling, so /maps/SURF_BEGINNER lands on (and consolidates into) surf_beginner.
    const canonical = await findMapNameIgnoringCase(validMapname);
    if (canonical) permanentRedirect(`/maps/${canonical}`);
    notFound();
  }

  // Cheap cached count; avoids the expensive records query on page render.
  const total = map.completions;

  // After notFound(), so a bogus name never queries; MapGraphPrecache keeps it warm for every map.
  // Awaited here, not in the chart grid's Suspense, so the tiles arrive with the header.
  const [percentiles, allMaps] = await Promise.all([
    getPercentileTimesFromCache(validMapname),
    getAllMapMetadataFromCache(),
  ]);
  const { similar, sameMapper } = relatedMaps([...allMaps.values()], map);
  const timeTiles = [
    { label: 'Top 1%', time: percentiles?.p1Time, icon: Medal },
    { label: 'Top 10%', time: percentiles?.p10Time, icon: Award },
    { label: 'Median', time: percentiles?.medianTime, icon: Timer },
    { label: 'Average', time: percentiles?.avgTime, icon: Clock },
  ];

  const mapImagesUrl = getMapImagesUrl();

  return (
    <div className="space-y-4">
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
            {/* Preloaded: the hero, and the blurred background shares its URL, so one early fetch serves both. */}
            <MapImage
              src={mapImageUrl(mapImagesUrl, map.mapname)}
              alt={map.mapname}
              unoptimized
              fill
              preload
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

      {map.wr_time != null && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          <StatTile
            icon={Trophy}
            value={formatTime(map.wr_time)}
            label="World Record"
            detail={map.wr_holder ? `by ${validatePlayerName(map.wr_holder)}` : undefined}
            href={map.wr_holder_steamid ? `/players/${map.wr_holder_steamid}` : undefined}
          />
          {timeTiles.map(({ label, time, icon }, i) =>
            time != null && (
              <StatTile key={label} icon={icon} value={formatTime(time)} label={label} accent={i % 2 === 0 ? 'secondary' : 'primary'} />
            )
          )}
        </div>
      )}

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

      {(similar.length > 0 || sameMapper.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <RelatedMapList title="Similar Maps" icon={MapIcon} maps={similar} />
          <RelatedMapList title="More by This Mapper" icon={User} maps={sameMapper} />
        </div>
      )}
    </div>
  );
}
