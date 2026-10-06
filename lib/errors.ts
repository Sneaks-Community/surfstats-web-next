// Imported by client and server code: keep it free of server-only dependencies.

/** Also handles plain `{ message }` objects (driver errors); falls back to 'Unknown error'. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Unknown error';
}

/** Driver error code (e.g. mysql2 `ER_*`, `ECONNREFUSED`) for log context, or 'N/A'. */
export function getErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    if (typeof code === 'number') return String(code);
  }
  return 'N/A';
}

/** Fetch/AbortController abort; safe to ignore. */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Thrown by `cachedFetch` when Valkey is down; `apiError` maps it to 503.
 * Lives here so both can import it without pulling in the cache module graph.
 */
export class CacheUnavailableError extends Error {
  constructor() {
    super('Cache unavailable');
    this.name = 'CacheUnavailableError';
  }
}

/**
 * Thrown by `withExpensiveQueryLimit` when its queue is full; `apiError` maps it to 503.
 * Shedding beats queueing behind a slow scan the caller has likely given up on.
 */
export class DbBusyError extends Error {
  constructor() {
    super('Database busy');
    this.name = 'DbBusyError';
  }
}
