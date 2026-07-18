import { Skeleton } from '@/components/Skeleton';

/**
 * Skeleton placeholder for the two-column player list. Shared between the
 * route-level `loading.tsx` (initial navigation) and the in-page
 * `<Suspense>` fallback that covers search-param changes (pagination / search),
 * which do not re-trigger `loading.tsx`. Mirrors `PlayerListTable`: two columns
 * of 10 rows on wide screens, collapsing to one continuous list below `xl`.
 */
function SkeletonColumn({ side }: { side: 'left' | 'right' }) {
  return (
    <div className={side === 'left' ? 'xl:border-r border-border' : 'border-t border-border xl:border-t-0'}>
      {/* Header (hidden on mobile for the right column, matching the real list). */}
      <div className={`${side === 'right' ? 'hidden xl:flex' : 'flex'} items-center gap-3 px-4 py-2.5 bg-surface/50 border-b border-border`}>
        <Skeleton className="h-3 w-10 rounded" />
        <Skeleton className="h-3 flex-1 max-w-[8rem] rounded" />
        <Skeleton className="h-3 w-12 rounded" />
        <Skeleton className="h-3 w-10 rounded" />
        <Skeleton className="h-3 w-16 rounded" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="h-4 w-8 rounded" />
            <Skeleton className="h-7 w-7 rounded-full shrink-0" />
            <Skeleton className="h-4 flex-1 max-w-xs rounded" />
            <Skeleton className="h-4 w-14 rounded" />
            <Skeleton className="h-4 w-10 rounded" />
            <Skeleton className="h-4 w-16 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PlayersTableSkeleton() {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="grid grid-cols-1 xl:grid-cols-2">
        <SkeletonColumn side="left" />
        <SkeletonColumn side="right" />
      </div>
    </div>
  );
}
