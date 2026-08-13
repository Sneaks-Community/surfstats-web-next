import { PanelSkeleton, Skeleton, SkeletonScreen } from '@/components/Skeleton';

export default function Loading() {
  return (
    <SkeletonScreen label="Loading map..." className="space-y-4">
      {/* Map header */}
      <PanelSkeleton>
        <div className="p-4 sm:p-6 flex flex-col md:flex-row gap-3 items-center md:items-end">
          <Skeleton className="h-48 w-full md:w-72 rounded-xl flex-shrink-0" />
          <div className="flex-1 w-full space-y-3">
            <div className="flex flex-wrap gap-3">
              <Skeleton className="h-7 w-20 rounded-full" />
              <Skeleton className="h-7 w-28 rounded-full" />
            </div>
            <Skeleton className="h-12 w-64 rounded-md" />
            <Skeleton className="h-5 w-40 rounded" />
          </div>
          <Skeleton className="h-24 w-full md:min-w-[120px] md:w-auto rounded-xl" />
        </div>
      </PanelSkeleton>

      {/* Chart grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="rounded-xl h-72" />
        ))}
      </div>

      {/* Leaderboard */}
      <PanelSkeleton>
        {/* Its own header bar: the real one is px-3 sm:px-6, not PanelHeader's px-4 */}
        <div className="border-b border-border px-6 py-3 bg-surface/50">
          <Skeleton className="h-4 w-32 rounded" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-6 py-4">
              <Skeleton className="h-4 w-8 rounded" />
              <Skeleton className="h-4 flex-1 max-w-xs rounded" />
              <Skeleton className="h-4 w-20 rounded" />
              <Skeleton className="h-4 w-16 rounded" />
              <Skeleton className="h-4 w-20 rounded" />
            </div>
          ))}
        </div>
      </PanelSkeleton>
    </SkeletonScreen>
  );
}
