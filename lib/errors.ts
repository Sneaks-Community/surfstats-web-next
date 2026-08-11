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
 * Extract a driver error code (mysql2 `ER_*`/`ECONNREFUSED`, ioredis, etc.) from
 * an unknown error value, for log context alongside {@link getErrorMessage}.
 * @param error - The caught value (typed `unknown`)
 * @returns The code, or 'N/A' when the value carries none
 */
export function getErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    if (typeof code === 'number') return String(code);
  }
  return 'N/A';
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
