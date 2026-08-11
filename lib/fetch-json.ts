/**
 * Client-side JSON fetch that fails on a non-2xx response.
 *
 * The API's error bodies are valid JSON (`{ error }`, built by `apiError`), so a
 * bare `response.json()` resolves successfully for a 403/429/503 and the
 * caller's `?? []` guard renders it as "no data" with no error surfaced. This
 * throws an {@link HttpError} instead, carrying the status and the server's
 * message. Safe to import from client components.
 */

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const { error } = body as { error?: unknown };
      if (typeof error === 'string' && error) return error;
    }
  } catch {
    // Non-JSON body (e.g. a proxy's HTML error page) — fall through.
  }
  return `Request failed (${response.status})`;
}

/**
 * @throws {HttpError} when the response status is not 2xx.
 * Abort errors from `init.signal` propagate as-is (check with `isAbortError`).
 */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new HttpError(response.status, await errorMessage(response));
  }
  return (await response.json()) as T;
}
