import { PageHeaderSkeleton, PanelSkeleton, Skeleton, SkeletonScreen } from '@/components/Skeleton';
import ChartSkeleton from '@/components/ChartSkeleton';

export default function Loading() {
  return (
    <SkeletonScreen label="Loading countries..." className="space-y-6">
      <PageHeaderSkeleton titleWidth="w-40" subtitleWidth="w-96" />

      {/* Global Reach panel */}
      <PanelSkeleton headerWidth="w-36">
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
      </PanelSkeleton>
    </SkeletonScreen>
  );
}
