import { describe, expect, it, vi } from 'vitest';

// Only `config` is under test; the gates would otherwise open a Valkey client.
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/origin-guard', () => ({ isTrustedRequest: vi.fn() }));
vi.mock('@/lib/valkey', () => ({ waitForCacheReady: vi.fn() }));

const { config } = await import('../proxy');

/** Next compiles each matcher entry as a full-path regex. */
function matches(pathname: string): boolean {
  return config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(pathname));
}

describe('proxy matcher', () => {
  // The gates only run on matched paths, so a dotted page that escapes the
  // matcher renders uncached, unmetered and without a CSP header.
  it('covers dotted paths', () => {
    expect(matches('/players/1.1')).toBe(true);
    expect(matches('/api/maps/surf.a/records')).toBe(true);
    expect(matches('/robots.txt')).toBe(true);
    expect(matches('/sitemap.xml')).toBe(true);
    expect(matches('/favicon.ico')).toBe(true);
  });

  it('covers ordinary pages, the API and the image optimizer', () => {
    expect(matches('/')).toBe(true);
    expect(matches('/maps')).toBe(true);
    expect(matches('/api/search')).toBe(true);
    expect(matches('/_next/image')).toBe(true);
  });

  // Immutable build assets: no DB, no render, nothing to meter.
  it('skips Next build assets', () => {
    expect(matches('/_next/static/chunks/main.js')).toBe(false);
  });
});
