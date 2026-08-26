import { describe, expect, it } from 'vitest';
import { STATIC_SECURITY_HEADERS, contentSecurityPolicy } from '../lib/security-headers';

/** The source list of one directive, e.g. `script-src` -> `'self' 'nonce-abc'`. */
function directive(csp: string, name: string): string {
  const found = csp.split('; ').find(part => part.startsWith(`${name} `));
  return found?.slice(name.length + 1) ?? '';
}

describe('contentSecurityPolicy', () => {
  // An inline <script> an attacker injects must not run.
  it('allows inline scripts only by nonce', () => {
    const csp = contentSecurityPolicy('abc123');

    expect(directive(csp, 'script-src')).toBe("'self' 'nonce-abc123'");
    expect(directive(csp, 'script-src')).not.toContain('unsafe-inline');
  });

  it('drops scripts entirely when no nonce is given, for the proxy error pages', () => {
    expect(directive(contentSecurityPolicy(), 'script-src')).toBe("'none'");
  });

  it('blocks plugins and framed content', () => {
    const csp = contentSecurityPolicy('abc123');

    expect(directive(csp, 'object-src')).toBe("'none'");
    expect(directive(csp, 'frame-src')).toBe("'none'");
    expect(directive(csp, 'frame-ancestors')).toBe("'none'");
  });

  // Styles are the deliberate exception: React writes style attributes, which a
  // nonce cannot cover.
  it('still allows inline styles', () => {
    expect(directive(contentSecurityPolicy('abc123'), 'style-src')).toContain("'unsafe-inline'");
  });
});

describe('STATIC_SECURITY_HEADERS', () => {
  it('carries HSTS and holds no per-request value', () => {
    expect(STATIC_SECURITY_HEADERS['Strict-Transport-Security']).toBe(
      'max-age=63072000; includeSubDomains'
    );
    expect(STATIC_SECURITY_HEADERS['Content-Security-Policy']).toBeUndefined();
  });
});
