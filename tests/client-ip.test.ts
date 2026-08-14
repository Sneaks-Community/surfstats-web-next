import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// Only headers are read, so a bare Headers object stands in for the request.
function request(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest;
}

// The trusted header is read at module scope, so reload after setting it.
async function load() {
  vi.resetModules();
  return import('../lib/client-ip');
}

afterEach(() => {
  delete process.env.TRUSTED_CLIENT_IP_HEADER;
});

describe('getClientIp', () => {
  it('reads x-forwarded-for by default', async () => {
    const { getClientIp } = await load();

    expect(getClientIp(request({ 'x-forwarded-for': '8.8.8.8' }))).toBe('8.8.8.8');
  });

  it('takes the right-most hop', async () => {
    const { getClientIp } = await load();

    expect(getClientIp(request({ 'x-forwarded-for': '1.1.1.1, 10.0.0.1' }))).toBe('10.0.0.1');
  });

  it('falls back to x-real-ip', async () => {
    const { getClientIp } = await load();

    expect(getClientIp(request({ 'x-real-ip': '203.0.113.5' }))).toBe('203.0.113.5');
    // An empty trusted header must not swallow the fallback.
    expect(getClientIp(request({ 'x-forwarded-for': '', 'x-real-ip': '203.0.113.5' }))).toBe(
      '203.0.113.5'
    );
  });

  it('honours TRUSTED_CLIENT_IP_HEADER over x-forwarded-for', async () => {
    process.env.TRUSTED_CLIENT_IP_HEADER = 'CF-Connecting-IP';
    const { getClientIp } = await load();

    expect(
      getClientIp(request({ 'cf-connecting-ip': '8.8.8.8', 'x-forwarded-for': '10.0.0.1' }))
    ).toBe('8.8.8.8');
  });

  // Only null may be treated as an unforwarded internal request.
  it('distinguishes an absent header from an unusable one', async () => {
    const { getClientIp } = await load();

    expect(getClientIp(request({ host: 'localhost:3000' }))).toBeNull();
    expect(getClientIp(request({ 'x-forwarded-for': ',' }))).toBe('');
    expect(getClientIp(request({ 'x-real-ip': '  ' }))).toBe('');
  });
});
