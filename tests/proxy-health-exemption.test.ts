import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const checkRateLimit = vi.fn();
const isTrustedRequest = vi.fn();
const waitForCacheReady = vi.fn();

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
vi.mock('@/lib/origin-guard', () => ({ isTrustedRequest: () => isTrustedRequest() }));
vi.mock('@/lib/valkey', () => ({ waitForCacheReady: () => waitForCacheReady() }));

// The healthcheck is `wget --spider`: no Origin, no Referer, no Sec-Fetch-*.
function healthcheckRequest(path = '/api/health') {
  return new NextRequest(`http://localhost:3000${path}`, { headers: { host: 'localhost:3000' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Worst case for the exemption: every gate would reject.
  isTrustedRequest.mockReturnValue(false);
  waitForCacheReady.mockResolvedValue(false);
  checkRateLimit.mockResolvedValue({ allowed: false, limit: 1, remaining: 0, resetSeconds: 60 });
});

describe('proxy /api/health exemption', () => {
  it('passes the healthcheck through every gate', async () => {
    const { proxy } = await import('../proxy');

    const res = await proxy(healthcheckRequest());

    // 200 here is middleware saying "continue to the route", not the route's body.
    expect(res.status).toBe(200);
    expect(isTrustedRequest).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(waitForCacheReady).not.toHaveBeenCalled();
  });

  // The origin guard is the gate that actually bit: wget sends no Origin, so
  // without the exemption the container would be permanently unhealthy.
  it('would be rejected by the origin guard without it', async () => {
    const { proxy } = await import('../proxy');
    waitForCacheReady.mockResolvedValue(true);

    const res = await proxy(healthcheckRequest('/api/search'));

    expect(res.status).toBe(403);
  });

  // Exact match only: a prefix would hand out an unmetered wildcard.
  it('does not exempt paths that merely start with it', async () => {
    const { proxy } = await import('../proxy');
    waitForCacheReady.mockResolvedValue(true);

    const res = await proxy(healthcheckRequest('/api/healthz'));

    expect(res.status).toBe(403);
  });
});
