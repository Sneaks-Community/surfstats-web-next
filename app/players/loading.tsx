import { Skeleton, SkeletonScreen } from '@/components/Skeleton';

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
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="border-b border-border px-6 py-3 bg-surface/50">
          <Skeleton className="h-4 w-24 rounded" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-6 py-4">
              <Skeleton className="h-4 w-8 rounded" />
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 flex-1 max-w-xs rounded" />
              <Skeleton className="h-4 w-16 rounded" />
              <Skeleton className="h-4 w-16 rounded" />
              <Skeleton className="h-4 w-20 rounded" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonScreen>
  );
}
