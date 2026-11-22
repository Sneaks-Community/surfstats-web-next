import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/logger', () => ({ default: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const ORIGINAL_ENV = process.env;

// SITE_NAME is read at module load, so each case sets the env, then loads a fresh module.
async function website(vars: Record<string, string>) {
  vi.resetModules();
  process.env = { NODE_ENV: 'test', NEXT_PUBLIC_SITE_NAME: 'Example Stats', ...vars };
  const { websiteJsonLd } = await import('../lib/structured-data');
  return websiteJsonLd('https://stats.example.com');
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('websiteJsonLd', () => {
  it('names this site and links the organization by reference only', async () => {
    expect(await website({ ORG_NAME: 'Example Community', ORG_URL: 'https://example.com/' })).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Example Stats',
      url: 'https://stats.example.com/',
      // Exact match: no logo, sameAs or alternateName, which belong to the organization's own site.
      publisher: {
        '@type': 'Organization',
        '@id': 'https://example.com/#organization',
        name: 'Example Community',
        url: 'https://example.com/',
      },
    });
  });

  it('gives the same @id with or without a trailing slash', async () => {
    const { publisher } = await website({ ORG_NAME: 'Example Community', ORG_URL: 'https://example.com' });
    expect(publisher).toMatchObject({ '@id': 'https://example.com/#organization', url: 'https://example.com/' });
  });

  it('falls back to NEXT_PUBLIC_MAIN_SITE_URL for the organization URL', async () => {
    const { publisher } = await website({ ORG_NAME: 'Example Community', NEXT_PUBLIC_MAIN_SITE_URL: 'https://example.com' });
    expect(publisher?.['@id']).toBe('https://example.com/#organization');
  });

  it('leaves out the publisher without a name or a usable URL', async () => {
    expect((await website({ ORG_URL: 'https://example.com/' })).publisher).toBeUndefined();
    expect((await website({ ORG_NAME: 'Example Community' })).publisher).toBeUndefined();
    // The fallback var isn't boot-validated, so a bad value must not throw on render.
    const bad = await website({ ORG_NAME: 'Example Community', NEXT_PUBLIC_MAIN_SITE_URL: 'not a url' });
    expect(bad.publisher).toBeUndefined();
    expect(JSON.parse(JSON.stringify(bad))).not.toHaveProperty('publisher');
  });
});

describe('serializeJsonLd', () => {
  it('escapes < so a value cannot close the script tag, and stays valid JSON', async () => {
    const { serializeJsonLd } = await import('../lib/structured-data');
    const data = { name: '</script><script>alert(1)</script>' };
    const out = serializeJsonLd(data);

    expect(out).not.toContain('<');
    expect(out).toContain('\\u003c/script>');
    expect(JSON.parse(out)).toEqual(data);
  });
});
