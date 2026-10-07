import { Skeleton } from '@/components/Skeleton';

function SkeletonColumn({ side }: { side: 'left' | 'right' }) {
  return (
    <div className={side === 'left' ? 'xl:border-r border-border' : 'border-t border-border xl:border-t-0'}>
      {/* Header row; the right column's is hidden below xl, like the real list. */}
      <div className={`${side === 'right' ? 'hidden xl:flex' : 'flex'} items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 bg-surface/50 border-b border-border`}>
        <Skeleton className="h-3 w-4 sm:w-10 rounded" />
        <Skeleton className="h-3 flex-1 max-w-[8rem] rounded" />
        <Skeleton className="h-3 w-8 sm:w-12 rounded" />
        <Skeleton className="h-3 w-10 rounded" />
        <Skeleton className="h-3 w-16 hidden sm:block rounded" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3">
            <Skeleton className="h-4 w-6 sm:w-8 rounded" />
            <Skeleton className="h-7 w-7 rounded-full shrink-0" />
            <Skeleton className="h-4 flex-1 max-w-xs rounded" />
            <Skeleton className="h-4 w-10 sm:w-14 rounded" />
            <Skeleton className="h-4 w-8 sm:w-10 rounded" />
            <Skeleton className="h-4 w-16 hidden sm:block rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** `PlayerListTable` placeholder (two columns of 10 rows, one list below `xl`) for the route
 * `loading.tsx` and the `PendingContent` fallback (search-param changes skip `loading.tsx`). */
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
