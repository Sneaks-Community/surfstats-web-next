import { Skeleton, SkeletonScreen } from '@/components/Skeleton';
import ChartSkeleton from '@/components/ChartSkeleton';

export default function Loading() {
  return (
    <SkeletonScreen label="Loading countries..." className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-40 rounded-md" />
        <Skeleton className="h-4 w-96 max-w-full rounded" />
      </div>

      {/* Global Reach panel */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <Skeleton className="h-5 w-36 rounded" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3">
          <div className="lg:col-span-2 p-4 border-b border-border lg:border-b-0 lg:border-r">
            <ChartSkeleton minBodyHeight={340} />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <Skeleton className="h-4 w-32 rounded" />
                <Skeleton className="h-4 w-12 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </SkeletonScreen>
  );
}
