import 'server-only';

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || 'Surf Stats';

/**
 * Shared shell for the proxy's short-circuit HTML responses. Inline styles, no
 * external assets and no inline scripts, so it renders while the app is
 * degraded and needs no CSP exemption.
 */
function errorPageHtml(
  heading: string,
  body: string,
  action: { href: string; label: string }
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${SITE_NAME} — ${heading}</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:#09090b; color:#e4e4e7;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  .card { max-width:28rem; margin:1.5rem; padding:2rem; text-align:center;
    background:#18181b; border:1px solid #27272a; border-radius:0.75rem; }
  .brand { font-size:0.8rem; letter-spacing:0.06em; text-transform:uppercase; color:#71717a; margin-bottom:1rem; }
  h1 { font-size:1.25rem; margin:0 0 0.5rem; }
  p { color:#a1a1aa; line-height:1.5; margin:0 0 1.5rem; }
  a.action { display:inline-block; font:inherit; color:#fff; background:#059669; border-radius:0.5rem;
    padding:0.6rem 1.25rem; text-decoration:none; }
  a.action:hover { background:#047857; }
</style>
</head>
<body>
  <div class="card">
    <div class="brand">${SITE_NAME}</div>
    <h1>${heading}</h1>
    <p>${body}</p>
    <a class="action" href="${action.href}">${action.label}</a>
  </div>
</body>
</html>`;
}

/**
 * Self-contained 503 page served (by the proxy) when Valkey is unavailable.
 */
export function cacheUnavailableHtml(): string {
  return errorPageHtml(
    'Temporarily unavailable',
    "We're reconnecting to our stats service. Please refresh in a moment.",
    { href: '/', label: 'Retry' }
  );
}

/**
 * Self-contained 429 page served (by the proxy) when a client exceeds the
 * page-route rate limit.
 *
 * @param resetSeconds - Seconds until the caller's window resets
 */
export function tooManyRequestsHtml(resetSeconds: number): string {
  return errorPageHtml(
    'Too many requests',
    `You've made a lot of requests in a short time. Please wait about ${resetSeconds} second${resetSeconds === 1 ? '' : 's'} and try again.`,
    { href: '/', label: 'Back to home' }
  );
}
