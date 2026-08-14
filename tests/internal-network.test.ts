import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// Only headers are read, so a bare Headers object stands in for the request.
function request(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest;
}

async function load() {
  vi.resetModules();
  return import('../lib/internal-network');
}

afterEach(() => {
  delete process.env.HEALTH_INTERNAL_IPS;
});

describe('isInternalRequest', () => {
  it('treats an unforwarded request as internal', async () => {
    const { isInternalRequest } = await load();

    expect(isInternalRequest(request({ host: 'localhost:3000' }))).toBe(true);
  });

  it('rejects an unforwarded request not addressed to loopback', async () => {
    const { isInternalRequest } = await load();

    expect(isInternalRequest(request({ host: 'surfstats.example.com' }))).toBe(false);
    expect(isInternalRequest(request({}))).toBe(false);
  });

  it('rejects an empty forwarding header', async () => {
    const { isInternalRequest } = await load();

    expect(isInternalRequest(request({ 'x-forwarded-for': ',', host: 'localhost:3000' }))).toBe(false);
  });

  it('classifies forwarded public addresses as external', async () => {
    const { isInternalRequest } = await load();

    expect(isInternalRequest(request({ 'x-forwarded-for': '8.8.8.8' }))).toBe(false);
    expect(isInternalRequest(request({ 'x-real-ip': '203.0.113.5' }))).toBe(false);
    expect(isInternalRequest(request({ 'x-forwarded-for': '172.32.0.1' }))).toBe(false);
  });

  it('accepts loopback, RFC1918, link-local and IPv6 private forms', async () => {
    const { isInternalRequest } = await load();

    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.1.1',
      '172.16.0.1',
      '172.31.255.255',
      '169.254.1.1',
      '::1',
      'fc00::1',
      'fd12::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      'fe80::1%eth0',
    ]) {
      expect(isInternalRequest(request({ 'x-forwarded-for': ip })), ip).toBe(true);
    }
  });

  // DRY-14: octets 3 and 4 were never parsed and nothing was range-checked, so
  // these all passed as private.
  it('rejects malformed IPv4 that only looks private', async () => {
    const { isInternalRequest } = await load();

    for (const ip of ['10.1.foo.bar', '10.999.1.1', '10.0.0.999', '10.0x1.1.1', '10.1.1']) {
      expect(isInternalRequest(request({ 'x-forwarded-for': ip })), ip).toBe(false);
    }
  });

  // The right-most hop is the address the proxy observed and appended; a
  // client-supplied left-most entry must not win.
  it('uses the right-most forwarded hop', async () => {
    const { isInternalRequest } = await load();

    expect(isInternalRequest(request({ 'x-forwarded-for': '10.0.0.1, 8.8.8.8' }))).toBe(false);
    expect(isInternalRequest(request({ 'x-forwarded-for': '8.8.8.8, 10.0.0.1' }))).toBe(true);
  });

  it('honours the HEALTH_INTERNAL_IPS allow list', async () => {
    process.env.HEALTH_INTERNAL_IPS = '203.0.113.7, 198.51.100.9';
    const { isInternalRequest } = await load();

    expect(isInternalRequest(request({ 'x-forwarded-for': '203.0.113.7' }))).toBe(true);
    expect(isInternalRequest(request({ 'x-forwarded-for': '198.51.100.9' }))).toBe(true);
    expect(isInternalRequest(request({ 'x-forwarded-for': '203.0.113.8' }))).toBe(false);
  });
});
