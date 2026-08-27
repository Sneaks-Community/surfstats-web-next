import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const logger = { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../lib/logger', () => ({ default: logger }));

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
  logger.warn.mockClear();
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

  it('warns once per process when the trusted header is missing', async () => {
    process.env.TRUSTED_CLIENT_IP_HEADER = 'cf-connecting-ip';
    const { getClientIp } = await load();

    getClientIp(request({ 'cf-connecting-ip': '8.8.8.8' }));
    expect(logger.warn).not.toHaveBeenCalled();

    getClientIp(request({ 'x-real-ip': '203.0.113.5' }));
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('x-real-ip');

    // A sustained misconfiguration must not log per request.
    getClientIp(request({ host: 'localhost:3000' }));
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
