import { PanelSkeleton, Skeleton, SkeletonScreen } from '@/components/Skeleton';

export default function Loading() {
  return (
    <SkeletonScreen label="Loading search results..." className="space-y-8 max-w-4xl mx-auto">
      {/* Search header: centred and oversized, so not PageHeaderSkeleton */}
      <div className="text-center space-y-4 py-8">
        <Skeleton className="h-10 w-40 rounded-md mx-auto" />
        <Skeleton className="h-14 w-full max-w-2xl rounded-xl mx-auto" />
      </div>

      {/* Two-column results */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {Array.from({ length: 2 }).map((_, col) => (
          <div key={col} className="space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <Skeleton className="h-6 w-24 rounded" />
              <Skeleton className="h-4 w-16 rounded" />
            </div>
            <PanelSkeleton className="divide-y divide-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-16 p-4">
                  <Skeleton className="h-full w-full rounded" />
                </div>
              ))}
            </PanelSkeleton>
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}
