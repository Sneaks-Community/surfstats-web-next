import { PageHeaderSkeleton, Skeleton, SkeletonScreen } from '@/components/Skeleton';

export default function Loading() {
  return (
    <SkeletonScreen label="Loading servers..." className="space-y-6">
      <PageHeaderSkeleton titleWidth="w-40" subtitleWidth="w-64" />

      {/* Server cards */}
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="rounded-xl h-28" />
        ))}
      </div>
    </SkeletonScreen>
  );
}
