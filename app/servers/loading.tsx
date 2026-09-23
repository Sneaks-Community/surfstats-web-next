import { PageHeaderSkeleton, Skeleton, SkeletonScreen } from '@/components/Skeleton';

export default function Loading() {
  return (
    <SkeletonScreen label="Loading servers..." className="space-y-6">
      <PageHeaderSkeleton titleWidth="w-40" subtitleWidth="w-64" />

      {/* Server cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="rounded-xl h-24" />
        ))}
      </div>
    </SkeletonScreen>
  );
}
