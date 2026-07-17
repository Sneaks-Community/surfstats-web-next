import { Skeleton } from '@/components/Skeleton';

/**
 * Skeleton placeholder for the maps card grid. Shared between the route
 * `loading.tsx` and the in-page `<Suspense>` fallback that covers filter /
 * pagination search-param changes.
 *
 * `count` should match the number of cards currently on screen so the grid
 * keeps the same height when it's swapped in during pagination — otherwise the
 * document shrinks and the browser clamps the user's scroll toward the top.
 */
export default function MapsGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-surface border border-border rounded-xl overflow-hidden">
          <Skeleton className="h-48 w-full" />
        </div>
      ))}
    </div>
  );
}
