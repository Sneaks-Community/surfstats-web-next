import Link from 'next/link';
import { Map as MapIcon, Layers, Target, Users, Flag } from 'lucide-react';
import { Suspense } from 'react';
import MapImage from '@/components/MapImage';
import MapFilters from '@/components/MapFilters';
import MapsGridSkeleton from '@/components/MapsGridSkeleton';
import { SkeletonScreen } from '@/components/Skeleton';
import { NavigationPendingProvider, PendingContent } from '@/components/NavigationPending';
import { getTierColor } from '@/lib/tierColors';
import { mapImageUrl } from '@/lib/utils';
import Pagination from '@/components/Pagination';
import { type MapMetadata } from '@/lib/map-cache';
import { getAllMapMetadataFromCache, getTierDistributionFromCache } from '@/lib/valkey-map-cache';
import { validateSearchQuery } from '@/lib/validators';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Maps',
};

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
  const getParam = (value: string | string[] | undefined, defaultValue = ''): string => {
    if (Array.isArray(value)) return value[0] || defaultValue;
    return value || defaultValue;
  };

  // Helper to get all values from string | string[] (for multi-select like tiers)
  const getParamArray = (value: string | string[] | undefined): string[] => {
    if (Array.isArray(value)) return value;
    if (value) return [value];
    return [];
  };

  const q = validateSearchQuery(getParam(params.q));
  const page = parseInt(getParam(params.page, '1'), 10);
  const type = getParam(params.type, 'all');
  // Handle tiers from URL - can be comma-separated or multiple params
  const tiersParams = getParamArray(params.tiers);
  const tiers = tiersParams.flatMap(t => t.split(',').map(tier => parseInt(tier.trim())).filter(tier => !isNaN(tier)));
  const mapper = getParam(params.mapper);
  const bonuses = getParam(params.bonuses, 'all');

  // Fetch all map metadata from Valkey cache
  const allMetadata = await getAllMapMetadataFromCache();

  // Apply filters to cached data
  const filteredMaps: MapMetadata[] = [];
  for (const metadata of allMetadata.values()) {
    // Apply search filter
    if (q && !metadata.mapname.toLowerCase().includes(q.toLowerCase())) continue;

    // Apply type filter (linear vs staged)
    if (type === 'linear' && metadata.stages > 0) continue;
    if (type === 'staged' && metadata.stages === 0) continue;

    // Apply tier filter
    if (tiers.length > 0 && !tiers.includes(metadata.tier)) continue;

    // Apply mapper filter
    if (mapper && !metadata.mapper.toLowerCase().includes(mapper.toLowerCase())) continue;

    // Apply bonuses filter
    if (bonuses !== 'all') {
      if (bonuses === '0' && metadata.bonuses !== 0) continue;
      if (bonuses === '4+' && metadata.bonuses < 4) continue;
      if (!['0', '4+'].includes(bonuses) && parseInt(bonuses) !== metadata.bonuses) continue;
    }

    filteredMaps.push(metadata);
  }

  // Sort by mapname
  filteredMaps.sort((a, b) => a.mapname.localeCompare(b.mapname));

  // Apply pagination
  const limit = 20;
  const offset = (page - 1) * limit;
  const total = filteredMaps.length;
  const paginatedMaps = filteredMaps.slice(offset, offset + limit);
  const totalPages = Math.ceil(total / limit);

  // Get filter options from cache
  const tierDistribution = await getTierDistributionFromCache();
  const filterOptions = {
    tiers: Array.from(tierDistribution.entries())
      .map(([tier, count]) => ({ tier, count }))
      .sort((a, b) => a.tier - b.tier),
  };

  const mapImagesUrl = process.env.MAP_IMAGES_URL || 'https://image.gametracker.com/images/maps/160x120/csgo/';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-text">Maps</h1>
            <p className="text-text-muted">Browse {total.toLocaleString()} surf maps</p>
          </div>
        </div>

        {/* Filter Panel */}
        <Suspense fallback={<div className="bg-surface border border-border rounded-xl p-4 h-32 animate-pulse" />}>
          <MapFilters tierOptions={filterOptions.tiers} />
        </Suspense>
      </div>

      {/* Pagination navigates through the provider, which shows the skeleton
          instantly. loading.tsx only covers the initial route load. */}
      <NavigationPendingProvider>
        <PendingContent fallback={<SkeletonScreen label="Loading maps..."><MapsGridSkeleton /></SkeletonScreen>}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {paginatedMaps.map((map) => {
              const tierColor = getTierColor(map.tier);
              return (
                <Link href={`/maps/${map.mapname}`} key={map.mapname} className="group block bg-surface border border-border rounded-xl overflow-hidden hover:border-primary/50 transition-colors">
                  <div className="relative h-48 bg-surface-hover w-full overflow-hidden">
                    <MapImage
                      src={mapImageUrl(mapImagesUrl, map.mapname)}
                      alt={map.mapname}
                      unoptimized
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-300"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-surface/10 to-transparent" />
                    <div className="absolute bottom-2 left-3 right-3">
                      <h3 className="text-lg font-bold text-white truncate drop-shadow-lg">{map.mapname}</h3>
                      <span className={`inline-block mt-1 px-2 py-0.5 bg-black/50 backdrop-blur-sm text-xs font-semibold rounded-md ${tierColor.text}`}>
                        Tier {map.tier}
                      </span>
                    </div>
                  <div className="absolute top-2 right-2 flex items-center gap-3 px-2 py-1 bg-black/50 backdrop-blur-sm rounded-md text-xs text-white">
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {map.completions.toLocaleString()}
                    </span>
                    <span className="flex items-center gap-1">
                      <Target className="h-3 w-3" />
                      {map.bonuses || 0}
                    </span>
                    <span className="flex items-center gap-1">
                      {map.stages > 1 ? (
                        <>
                          <Layers className="h-3 w-3" />
                          {map.stages}
                        </>
                      ) : map.checkpoints > 0 ? (
                        <>
                          <Flag className="h-3 w-3" />
                          {map.checkpoints}
                        </>
                      ) : (
                        'Linear'
                      )}
                    </span>
                  </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {paginatedMaps.length === 0 && (
            <div className="text-center py-12 bg-surface border border-border rounded-xl">
              <MapIcon className="h-12 w-12 text-text-placeholder mx-auto mb-4" />
              <h3 className="text-lg font-medium text-text">No maps found</h3>
              <p className="text-text-muted mt-1">Try adjusting your search or filters.</p>
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
        </PendingContent>
      </NavigationPendingProvider>
    </div>
  );
}
