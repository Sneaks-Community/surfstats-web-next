async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const { error } = body as { error?: unknown };
      if (typeof error === 'string' && error) return error;
    }
  } catch {
    // Non-JSON body (e.g. a proxy's HTML error page).
  }
  return `Request failed (${response.status})`;
}

/**
 * Client-safe fetch that throws on non-2xx with the server's `{ error }` message: error bodies
 * are valid JSON and would otherwise render as "no data". Aborts propagate as-is (`isAbortError`).
 */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }
  return (await response.json()) as T;
}
