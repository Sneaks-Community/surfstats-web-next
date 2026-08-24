import Link from '@/components/Link';

/**
 * Root 404 boundary. Rendered by `notFound()` from anywhere in the tree and by
 * Next for unmatched routes, with a real HTTP 404 status. The pages that used
 * to inline their own "not found" markup returned 200, which search engines
 * index as soft 404s.
 */
export default function NotFound() {
  return (
    <div className="text-center py-20 bg-surface border border-border rounded-xl">
      <h1 className="text-2xl font-bold text-text mb-2">Not Found</h1>
      <p className="text-text-muted">
        That page does not exist, or the player or map is not in the database.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Link
          href="/players"
          className="inline-block px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-md transition-colors"
        >
          Browse Players
        </Link>
        <Link
          href="/maps"
          className="inline-block px-4 py-2 bg-surface-hover hover:bg-surface text-text border border-border rounded-md transition-colors"
        >
          Browse Maps
        </Link>
      </div>
    </div>
  );
}
