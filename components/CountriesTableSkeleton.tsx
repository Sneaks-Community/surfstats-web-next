import { Skeleton } from '@/components/Skeleton';

/**
 * Skeleton placeholder for the countries ranking table. Shared between the
 * route `loading.tsx` and the in-page `<Suspense>` fallback that covers
 * sort/pagination search-param changes. Row count matches the page size (25).
 */
export default function CountriesTableSkeleton() {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="border-b border-border px-6 py-3 bg-surface/50">
        <Skeleton className="h-4 w-24 rounded" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: 25 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-6 py-4">
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
