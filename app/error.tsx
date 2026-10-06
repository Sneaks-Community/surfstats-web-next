'use client';

import Link from '@/components/Link';

/** Root error boundary, mostly for `DbBusyError` from the expensive-query cap under load: an honest
 * retry beats an empty result the reader would take for a real answer. */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="text-center py-20 bg-surface border border-border rounded-xl">
      <h1 className="text-2xl font-bold text-text mb-2">Temporarily Unavailable</h1>
      <p className="text-text-muted">
        The server is busy right now. This page could not be loaded, so nothing below is
        missing data — please try again in a moment.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-block px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-md transition-colors"
        >
          Try Again
        </button>
        <Link
          href="/"
          className="inline-block px-4 py-2 bg-surface-hover hover:bg-surface text-text border border-border rounded-md transition-colors"
        >
          Home
        </Link>
      </div>
    </div>
  );
}
