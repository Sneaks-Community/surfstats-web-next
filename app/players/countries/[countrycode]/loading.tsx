import { Skeleton, SkeletonScreen } from '@/components/Skeleton';
import PlayersTableSkeleton from '@/components/PlayersTableSkeleton';

export default function Loading() {
  return (
    <SkeletonScreen label="Loading country players..." className="space-y-4">
      {/* Back link */}
      <Skeleton className="h-4 w-40 rounded" />

      {/* Country header: flag beside the title, so not PageHeaderSkeleton */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-12 w-12 rounded-md" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-48 rounded-md" />
          <Skeleton className="h-4 w-56 rounded" />
        </div>
      </div>

      <PlayersTableSkeleton />
    </SkeletonScreen>
  );
}
