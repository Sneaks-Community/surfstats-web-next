import { Skeleton } from '@/components/Skeleton';

/** Maps card grid placeholder for the route `loading.tsx` and the `PendingContent` fallback on
 * filter/pagination changes. `count` should match the cards on screen so the grid keeps its height;
 * otherwise the document shrinks and the browser clamps the scroll toward the top. */
export default function MapsGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-surface border border-border rounded-xl overflow-hidden">
          <Skeleton className="aspect-video w-full" />
        </div>
      ))}
    </div>
  );
}
