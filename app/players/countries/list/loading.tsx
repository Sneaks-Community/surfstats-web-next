import { Skeleton, SkeletonScreen } from '@/components/Skeleton';
import CountriesTableSkeleton from '@/components/CountriesTableSkeleton';

export default function Loading() {
  return (
    <SkeletonScreen label="Loading countries..." className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-28 rounded" />
        <Skeleton className="h-8 w-48 rounded-md" />
        <Skeleton className="h-4 w-96 max-w-full rounded" />
      </div>

      {/* Table */}
      <CountriesTableSkeleton />
    </SkeletonScreen>
  );
}
