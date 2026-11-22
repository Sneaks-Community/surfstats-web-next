import { PageHeaderSkeleton, Skeleton, SkeletonScreen } from '@/components/Skeleton';
import MapsGridSkeleton from '@/components/MapsGridSkeleton';

export default function Loading() {
  return (
    <SkeletonScreen label="Loading maps..." className="space-y-6">
      <div className="flex flex-col gap-4">
        <PageHeaderSkeleton titleWidth="w-28" subtitleWidth="w-48" />
        {/* Filter bar */}
        <Skeleton className="rounded-xl h-32" />
      </div>

      <MapsGridSkeleton />
    </SkeletonScreen>
  );
}
