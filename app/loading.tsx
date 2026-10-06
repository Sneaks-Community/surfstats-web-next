import { PanelSkeleton, Skeleton, SkeletonScreen } from '@/components/Skeleton';

export default function Loading() {
  return (
    <SkeletonScreen label="Loading dashboard..." className="space-y-5">
      {/* Oversized hero heading plus the Play Now button, so not PageHeaderSkeleton */}
      <div className="pt-1 pb-2 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="space-y-2 min-w-0">
          <Skeleton className="h-9 w-80 max-w-full rounded-md" />
          <Skeleton className="h-6 w-96 max-w-full rounded" />
        </div>
        <Skeleton className="h-12 w-full sm:w-36 rounded-lg shrink-0" />
      </div>

      {/* Stat tiles (denser at xl, like StatTile) and the activity ticker */}
      <div className="space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-surface border border-border rounded-xl p-4 xl:p-3 flex items-center gap-4 xl:gap-3">
              <Skeleton className="h-11 w-11 xl:h-9 xl:w-9 rounded-lg shrink-0" />
              <div className="space-y-2 xl:space-y-1 min-w-0">
                <Skeleton className="h-7 xl:h-5 w-20 rounded-md" />
                <Skeleton className="h-3 w-24 xl:w-20 rounded" />
              </div>
            </div>
          ))}
        </div>

        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-4 pt-2">
            <Skeleton className="h-3 w-28 rounded" />
          </div>
          <div className="flex overflow-hidden">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2.5 shrink-0 border-l border-border pl-4 pr-5 py-3">
                <Skeleton className="h-10 w-10 rounded-md shrink-0" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-28 rounded" />
                  <Skeleton className="h-3 w-24 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Players */}
        <PanelSkeleton headerWidth="w-32">
          <div className="divide-y divide-border">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                <Skeleton className="h-7 w-7 rounded-md shrink-0" />
                <Skeleton className="h-9 w-9 rounded-full shrink-0" />
                {/* Bars sit in boxes the size of the name line and CountryBadge, so rows match the real height */}
                <div className="flex-1 min-w-0">
                  <div className="h-5 flex items-center">
                    <Skeleton className="h-4 w-32 max-w-full rounded" />
                  </div>
                  <div className="mt-1 h-6 flex items-center">
                    <Skeleton className="h-3 w-24 rounded" />
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <Skeleton className="h-4 w-14 rounded" />
                  <Skeleton className="h-3 w-16 rounded" />
                </div>
              </div>
            ))}
          </div>
        </PanelSkeleton>

        {/* Popular Maps */}
        <PanelSkeleton headerWidth="w-36" className="flex flex-col">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 flex-1 auto-rows-fr">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="flex flex-col rounded-lg overflow-hidden border border-border">
                <Skeleton className="flex-1 min-h-24" />
                <div className="p-2.5 space-y-1.5">
                  <Skeleton className="h-4 w-24 max-w-full rounded" />
                  <Skeleton className="h-3 w-20 rounded" />
                </div>
              </div>
            ))}
          </div>
        </PanelSkeleton>
      </div>
    </SkeletonScreen>
  );
}
