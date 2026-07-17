/**
 * Error helpers shared across client and server code.
 * Safe to import anywhere — no server-only dependencies.
 */

/**
 * Safely extract a human-readable message from an unknown error value.
 * Handles both `Error` instances and plain `{ message }` objects (e.g. driver errors).
 * @param error - The caught value (typed `unknown`)
 * @returns The message, or 'Unknown error' when none can be found
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Unknown error';
}

/**
 * Whether an error is a fetch/AbortController abort (safe to ignore).
 * @param error - The caught value
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Thrown by `cachedFetch` when Valkey is unreachable; `apiError` turns it into
 * a 503. Lives here so both can import it without the cache module graph.
 */
export class CacheUnavailableError extends Error {
  constructor() {
    super('Cache unavailable');
    this.name = 'CacheUnavailableError';
  }
}
