import { PanelSkeleton, Skeleton, SkeletonScreen } from '@/components/Skeleton';

export default function Loading() {
  return (
    <SkeletonScreen label="Loading player profile..." className="space-y-4">
      {/* Profile header */}
      <PanelSkeleton>
        <div className="h-20 bg-surface-hover animate-pulse" />
        <div className="px-4 sm:px-6 pb-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end -mt-8 sm:-mt-10 mb-4">
            <Skeleton className="h-16 w-16 sm:h-24 sm:w-24 rounded-xl border-4 border-surface flex-shrink-0" />
            <div className="flex-1 pb-2 space-y-2">
              <Skeleton className="h-8 w-48 rounded-md" />
              <div className="flex flex-wrap gap-4">
                <Skeleton className="h-6 w-40 rounded" />
                <Skeleton className="h-6 w-24 rounded" />
                <Skeleton className="h-6 w-32 rounded" />
              </div>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 md:grid-cols-[1fr_1fr_1fr_1fr_2fr] gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-surface border border-border rounded-xl p-3 flex flex-col items-center justify-center gap-2">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-6 w-16 rounded-md" />
                <Skeleton className="h-3 w-20 rounded" />
              </div>
            ))}
            <div className="bg-surface border border-border rounded-xl p-3 col-span-2 md:col-start-5 md:row-start-1 flex flex-col justify-center gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full rounded" />
              ))}
            </div>
          </div>
        </div>
      </PanelSkeleton>

      {/* Tab bar */}
      <div className="flex gap-2">
        <Skeleton className="h-9 w-28 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>

      {/* Overview charts */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        <Skeleton className="lg:col-span-1 h-[280px] rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:col-span-3">
          <Skeleton className="h-[280px] rounded-xl" />
          <Skeleton className="h-[280px] rounded-xl" />
        </div>
      </div>
    </SkeletonScreen>
  );
}
