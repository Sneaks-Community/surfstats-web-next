# SurfStats Web — Agent Guide

Web interface for CS:GO surf player stats, map records, and live server status, reading a ckSurf timer database. Next.js 16 App Router.

## Commands

```bash
npm run dev        # dev server (pipe to pino-pretty for readable logs: npm run dev 2>&1 | npx pino-pretty)
npm run build      # production build
npm run lint       # eslint (also lint:fix to autofix)
npm run typecheck  # tsc --noEmit
npm test           # vitest run (test:watch for watch mode)
```

Always run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` before finishing. Resolve all warnings/errors. Node >= 24 (see `.nvmrc`).

Tests are vitest specs in `tests/` as `*.test.ts`, one per `lib/` module, covering the pure logic modules only (validation, country/ISO mapping, formatting, SteamID conversion, cache-wrapper contracts, IP classification, env parsing). There is no DOM runner, so components are still verified by running the app. Anything touching MySQL or Valkey is mocked; no test needs a live service.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript 6 (strict) · Tailwind CSS 4 · MySQL2 3 · Valkey via `redis` 6 · Pino 10 · Zod 4 · Chart.js 4 + react-chartjs-2 5 (+ chartjs-chart-geo, topojson-client, world-atlas for the world map) · GameDig 5 · i18n-iso-countries · lucide-react · country-flag-icons · server-only.

## ckSurf domain model

Maps are **Linear** (with checkpoints) or **Staged** (with restartable stages). **Bonuses** have neither. Zones live in `ck_zones`, keyed by three columns:

- `zonetype`: 1 Start · 2 End · 3 Stage · 4 Checkpoint
- `zonegroup`: 0 Map · >=1 Bonus N
- `zonetypeid`: stage ordering only (id 0 = Stage 1, id 4 = Stage 5)

E.g. zonetype 1 / zonegroup 0 = map start; zonetype 2 / zonegroup 4 = Bonus 4 end.

## Layout

```
app/            App Router: pages, app/api/* routes, app/components/* (home, countries)
components/     Shared UI (nav, search, filters, badges, pagination, tables, charts scaffolding)
hooks/          Client hooks (useDebounce, usePagination, useRecordSearch)
lib/            Server logic: db, caching, analytics, steam, validators, theme, env
types/          Type defs
instrumentation.ts  Startup hook (runs once per server): defers to lib/startup.ts
proxy.ts        Next proxy (middleware): rate limit, origin guard, cache-readiness gate for /api/* and pages
sql/            Reference schema (surf85.sql) + performance-index migrations; add new index migrations here
```

API routes: `maps/[mapname]/{records,bonuses,stages}`, `players/[steamid]/{maps,bonuses,stages}`, `search`, `health`.

## Conventions

**Server-first.** Default to server components; add `'use client'` only for interactivity. Server-only modules import `'server-only'`.

**Database.** Use the pools in [`lib/db.ts`](lib/db.ts) (main ckSurf DB, default `cksurf`) and [`lib/db-analytics.ts`](lib/db-analytics.ts) (optional `player_analytics_surf`, degrades gracefully if absent). Both wrap queries via [`wrapPoolQuery`](lib/db-query-logger.ts) for slow-query logging. Parameterized queries only. Expensive scans go through the semaphore in [`lib/db-semaphore.ts`](lib/db-semaphore.ts). Never query the DB directly from components — use cached lib functions.

**Caching.** Valkey (Redis-compatible), cache-aside. Client in [`lib/valkey.ts`](lib/valkey.ts); per-domain caches in `lib/valkey-*.ts` and `lib/*-cache.ts`. All keys use the `surfstats:` prefix. Keys or TTLs that more than one module has to agree on live in [`lib/cache-keys.ts`](lib/cache-keys.ts); build them from there, never as a second literal. If Valkey is unreachable, `proxy.ts` serves a "temporarily unavailable" page rather than running uncached queries.

**Background-first caching.** Anything expensive is kept fresh by a refresher, so a page visit reads what is cached and never triggers a reload. A refresher recomputes a key with `{ force: true }` ([`cachedFetch`](lib/cached-fetch.ts), threaded through the getters it owns), never `DEL` then refetch: deleting is what leaves a window for a visitor to pay for the query, and a failed forced reload keeps serving the previous value. For a key a refresher owns, the interval is the freshness guarantee and the TTL is only a safety net, so set the TTL to about 3x the interval; the on-demand path stays as the cold-cache fallback. Keys nobody refreshes (deep pages, alternate sorts, searches, most player profiles) keep short TTLs and stay on demand.

**Startup and background work.** Nothing starts at module scope: [`instrumentation.ts`](instrumentation.ts) → [`lib/startup.ts`](lib/startup.ts) is the single hook (env validation, DB probe, then the background tasks — each refresher's first run is also its cache warm). Every recurring task goes through [`createBackgroundRefresh`](lib/background-refresh.ts), which is idempotent across module re-evaluations and clears its timer via [`onShutdown`](lib/shutdown.ts). [`lib/shutdown.ts`](lib/shutdown.ts) owns the signals: it takes over the `SIGTERM`/`SIGINT` listeners Next installed before `register()` ran, lets Next's request drain finish (its `process.exit` is suppressed for that window, since it awaits nothing the app registered), then runs the handlers and exits. Register cleanup with `onShutdown`, never with a signal listener of your own.

**Validation.** Zod schemas in [`lib/validators.ts`](lib/validators.ts) (`validateMapName`, `validateSteamId`, `validateSearchQuery`, `validatePlayerName`). Never hand-roll sanitization. Env is validated at boot in [`lib/env.ts`](lib/env.ts).

**Logging.** `import logger from '@/lib/logger'`; prefix messages by module, e.g. `[DB]`, `[Steam]`. No `console.log`. Level via `LOG_LEVEL` (default `warn`).

**Errors.** Wrap async in try/catch, log via Pino, return a fallback for graceful degradation.

**Types.** Interfaces for all data shapes; extend `RowDataPacket` for query rows.

**Theme.** Theme-aware Tailwind tokens only (`text-text`, `text-text-muted`, `bg-surface`, `bg-background-secondary`, `border-border`); no hardcoded colors. Support light and dark (`dark:` prefix), WCAG AA contrast. Colors are injected as CSS vars from env: `THEME_PRIMARY`, `THEME_SECONDARY`, `THEME_DARK_BACKGROUND`, `THEME_DARK_SURFACE`, `THEME_LIGHT_BACKGROUND`, `THEME_LIGHT_SURFACE`. See [`lib/theme-config.ts`](lib/theme-config.ts).

**Responsive.** Mobile-first; Tailwind breakpoints; >=44px touch targets; horizontal scroll for tables.

**Reuse & efficiency.** Prefer existing queries/caches/functions over new ones; keep queries lean. Record tables share [`useRecordSearch`](hooks/useRecordSearch.ts) (debounced server-side player search: query state, cancellation, its own error and retry, result pagination) and, on the map page, [`LeaderboardTable`](app/maps/[mapname]/components/LeaderboardTable.tsx) for the columns and the too-short/error/loading/empty ladder. Page sizes are `ITEMS_PER_PAGE` and `RECORDS_PAGE_SIZE` in [`lib/utils.ts`](lib/utils.ts), never a second literal.

## Key DB tables (ckSurf)

`ck_maptier` (tier, mapper) · `ck_playertimes` (map completions) · `ck_bonus` · `ck_stages` · `ck_zones` (see domain model) · `ck_checkpoints` (cp1–cp75) · `ck_playerrank` (points, finishedmaps, country) · `ck_latestrecords` · `ck_stats` · `ck_playeroptions` · `ck_playertitles`.

Analytics DB: `player_analytics` (connection/time-on-server tracking).

### Gotchas

- Maps-completed count reads `ck_playerrank.finishedmaps` — it is the source of truth, *not* a `COUNT(*)` over `ck_playertimes`.
- `ck_playerrank.country` holds GeoIP English country names; map them via [`lib/countries.ts`](lib/countries.ts) (i18n-iso-countries), unmapped → `UN`/skip.

## Config

Env template in `.env.example` (validated by `lib/env.ts`). Required: `MYSQL_*`. Optional: `ANALYTICS_MYSQL_*`, `VALKEY_*`, `STEAM_API_KEY` (avatars/names), `SERVERS_JSON` (live status), `MAP_IMAGES_URL`, `RATE_LIMIT_*`, `ALLOWED_ORIGINS`, `DB_*` pool tuning, `PLAYERS_LIST_WARM_*`, `THEME_*`, `NEXT_PUBLIC_*`, `LOG_LEVEL`, `MAX_TIER`. Deploy via Docker (`output: 'standalone'`); security headers live in [`lib/security-headers.ts`](lib/security-headers.ts), applied by [`next.config.ts`](next.config.ts) to rendered routes and by [`proxy.ts`](proxy.ts) to its short-circuit responses (which `headers()` never reaches). The CSP is per-request and nonce-based, so there is no `'unsafe-inline'` for scripts: any hand-written inline `<script>` must carry `nonce={(await headers()).get('x-nonce')}` or it will not run.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->