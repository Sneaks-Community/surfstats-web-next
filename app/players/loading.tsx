import { PageHeaderSkeleton, Skeleton, SkeletonScreen } from '@/components/Skeleton';
import PlayersTableSkeleton from '@/components/PlayersTableSkeleton';

export default function Loading() {
  return (
    <SkeletonScreen label="Loading players..." className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeaderSkeleton titleWidth="w-32" subtitleWidth="w-56" />
        <Skeleton className="h-10 w-full sm:w-72 rounded-md" />
      </div>

      <PlayersTableSkeleton />
    </SkeletonScreen>
  );
}
