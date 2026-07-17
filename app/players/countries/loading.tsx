import { Skeleton, SkeletonScreen } from '@/components/Skeleton';

export default function Loading() {
  return (
    <SkeletonScreen label="Loading countries..." className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-40 rounded-md" />
        <Skeleton className="h-4 w-96 max-w-full rounded" />
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
              <Skeleton className="h-4 flex-1 max-w-xs rounded" />
              <Skeleton className="h-4 w-20 rounded" />
              <Skeleton className="h-4 w-16 rounded" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonScreen>
  );
}
