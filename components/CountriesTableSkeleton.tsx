import { Skeleton } from '@/components/Skeleton';

/** Countries table placeholder for the route `loading.tsx` and the `PendingContent` fallback on
 * sort/pagination changes; 20 rows to match `ITEMS_PER_PAGE`. */
export default function CountriesTableSkeleton() {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="border-b border-border px-4 py-2 bg-surface/50">
        <Skeleton className="h-4 w-24 rounded" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
            <Skeleton className="h-4 w-8 rounded" />
            <Skeleton className="h-4 flex-1 max-w-xs rounded" />
            <Skeleton className="h-4 w-20 rounded" />
            <Skeleton className="h-4 w-16 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
