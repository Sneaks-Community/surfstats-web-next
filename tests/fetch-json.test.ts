import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError, fetchJson } from '../lib/fetch-json';

function response(status: number, body: unknown, ok = status < 300): Response {
  return {
    ok,
    status,
    json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)),
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('fetchJson', () => {
  it('returns the parsed body on success', async () => {
    vi.mocked(fetch).mockResolvedValue(response(200, { records: [1, 2] }));

    expect(await fetchJson<{ records: number[] }>('/api/x')).toEqual({ records: [1, 2] });
  });

  // These bodies are valid JSON, so a bare .json() would resolve and the caller's
  // `?? []` would render an empty table instead of an error.
  it('throws HttpError carrying the status and the server message', async () => {
    for (const [status, message] of [
      [400, 'Invalid map name'],
      [403, 'Forbidden'],
      [429, 'Too many requests'],
      [503, 'Cache unavailable'],
    ] as const) {
      vi.mocked(fetch).mockResolvedValue(response(status, { error: message }));

      const error = await fetchJson('/api/x').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(status);
      expect((error as HttpError).message).toBe(message);
    }
  });

  it('falls back to a generic message when the body is not the expected JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(response(502, new Error('<html>bad gateway</html>')));

    await expect(fetchJson('/api/x')).rejects.toThrow('Request failed (502)');
  });

  it('falls back when the JSON body has no usable error field', async () => {
    vi.mocked(fetch).mockResolvedValue(response(500, { message: 'nope' }));

    await expect(fetchJson('/api/x')).rejects.toThrow('Request failed (500)');
  });

  // The tabs rely on aborts staying distinguishable so a cancelled request
  // isn't rendered as a failure.
  it('propagates abort errors unchanged', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    vi.mocked(fetch).mockRejectedValue(abort);

    await expect(fetchJson('/api/x')).rejects.toBe(abort);
  });
});
