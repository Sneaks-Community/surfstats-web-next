import { Skeleton } from '@/components/Skeleton';

/**
 * Skeleton placeholder for the maps card grid. Shared between the route
 * `loading.tsx` and the in-page `<Suspense>` fallback that covers filter /
 * pagination search-param changes.
 */
export default function MapsGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="bg-surface border border-border rounded-xl overflow-hidden">
          <Skeleton className="h-48 w-full" />
        </div>
      ))}
    </div>
  );
}
