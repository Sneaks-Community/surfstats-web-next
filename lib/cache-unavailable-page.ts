import 'server-only';

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || 'Surf Stats';

/**
 * Self-contained 503 page served (by the proxy) when Valkey is unavailable.
 * Inline styles, no external assets, so it renders even while the app is degraded.
 */
export function cacheUnavailableHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${SITE_NAME} — Temporarily unavailable</title>
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
  button { font:inherit; color:#fff; background:#059669; border:0; border-radius:0.5rem;
    padding:0.6rem 1.25rem; cursor:pointer; }
  button:hover { background:#047857; }
</style>
</head>
<body>
  <div class="card">
    <div class="brand">${SITE_NAME}</div>
    <h1>Temporarily unavailable</h1>
    <p>We're reconnecting to our stats service. Please refresh in a moment.</p>
    <button onclick="location.reload()">Refresh</button>
  </div>
</body>
</html>`;
}
