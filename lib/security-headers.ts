/**
 * Security headers, shared by the two places that can emit them:
 * `next.config.ts` (every rendered route) and `proxy.ts` (its short-circuit 403
 * / 429 / 503 responses, which never reach the config's `headers()`).
 */

const isDevelopment = process.env.NODE_ENV === 'development';

/** Headers whose value does not vary per request. */
export const STATIC_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // Ignored over plain HTTP, so it only takes effect behind the TLS terminator.
  // It also covers subdomains: every host under this domain must serve HTTPS.
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
};

/**
 * Per-request CSP. The nonce is what replaces `'unsafe-inline'` for scripts:
 * Next parses this header while rendering and stamps the value onto every
 * script tag it emits, and `app/layout.tsx` reads it back from `x-nonce` for
 * the theme bootstrap. Omit it for a response that carries no scripts at all,
 * which drops `script-src` to `'none'`.
 *
 * `style-src` keeps `'unsafe-inline'` deliberately: React writes `style`
 * attributes (chart canvases, the injected theme variables) and an attribute
 * cannot carry a nonce.
 */
export function contentSecurityPolicy(nonce?: string): string {
  const scriptSrc = nonce
    ? `'self' 'nonce-${nonce}'${isDevelopment ? " 'unsafe-eval'" : ''}`
    : "'none'";

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "font-src 'self'",
    "connect-src 'self' https://api.steampowered.com",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
