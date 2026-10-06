// Shared by next.config.ts and proxy.ts, whose short-circuit responses never reach `headers()`.

const isDevelopment = process.env.NODE_ENV === 'development';

export const STATIC_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // Only takes effect over HTTPS (behind the TLS terminator). includeSubDomains: every
  // host under this domain must serve HTTPS.
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
};

/**
 * Per-request CSP. The nonce replaces `'unsafe-inline'` for scripts: Next stamps it on its
 * script tags and `app/layout.tsx` reads it from `x-nonce`. Omit it to get `script-src 'none'`.
 */
export function contentSecurityPolicy(nonce?: string): string {
  const scriptSrc = nonce
    ? `'self' 'nonce-${nonce}'${isDevelopment ? " 'unsafe-eval'" : ''}`
    : "'none'";

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Deliberate: React `style` attributes (charts, theme vars) cannot carry a nonce.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
