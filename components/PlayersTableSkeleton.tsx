import { Skeleton } from '@/components/Skeleton';

/**
 * Skeleton placeholder for the players table. Shared between the route-level
 * `loading.tsx` (initial navigation) and the in-page `<Suspense>` fallback
 * that covers search-param changes (pagination / search), which do not
 * re-trigger `loading.tsx`. Row count matches the page size (20).
 */
export default function PlayersTableSkeleton() {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="border-b border-border px-6 py-3 bg-surface/50">
        <Skeleton className="h-4 w-24 rounded" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: 20 }).map((_, i) => (
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
  );
}
