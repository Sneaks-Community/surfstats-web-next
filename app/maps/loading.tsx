import { Skeleton, SkeletonScreen } from '@/components/Skeleton';

export default function Loading() {
  return (
    <SkeletonScreen label="Loading maps..." className="space-y-6">
      {/* Header + filters */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-28 rounded-md" />
            <Skeleton className="h-4 w-48 rounded" />
          </div>
        </div>
        <Skeleton className="rounded-xl h-32" />
      </div>

      {/* Map card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="bg-surface border border-border rounded-xl overflow-hidden">
            <Skeleton className="h-48 w-full" />
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}
