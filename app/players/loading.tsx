import { Skeleton, SkeletonScreen } from '@/components/Skeleton';
import PlayersTableSkeleton from '@/components/PlayersTableSkeleton';

export default function Loading() {
  return (
    <SkeletonScreen label="Loading players..." className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32 rounded-md" />
          <Skeleton className="h-4 w-56 rounded" />
        </div>
        <Skeleton className="h-10 w-full sm:w-72 rounded-md" />
      </div>

      {/* Table */}
      <PlayersTableSkeleton />
    </SkeletonScreen>
  );
}
