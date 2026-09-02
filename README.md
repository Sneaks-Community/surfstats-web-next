> [!CAUTION]
> THIS PROJECT IS UNDER EARLY PHASE ACTIVE DEVELOPMENT
> Expect bugs, improper documentation, and no support.

# SurfStats - CS:GO Surf Statistics Web Interface

A modern, fast, and responsive web interface for displaying player statistics, map records, and live server status for CS:GO surf servers running the ckSurf timer plugin.

## Features

* **Dashboard:** Real-time statistics including total players, map completions, bonus completions, stage completions, total points, and recent records display.
* **Player Leaderboards:** Browse top players ranked by points or finished maps with pagination support.
* **Player Profiles:** Detailed individual player pages with Steam integration displaying avatars, country flags, and personal statistics.
* **Map Records:** Browse all available maps with advanced filtering:
  * Search by map name or mapper name
  * Filter by type (Linear/Staged)
  * Filter by bonus count (0, 1, 2, 3, 4+)
  * Filter by difficulty tier (T1-T10)
* **Map Details:** View top completion times, bonus records, and stage times for each map.
* **Live Server Status:** Real-time server monitoring showing current map, player count, and active player list.
* **Global Search:** Quickly find players by name or SteamID, search for specific maps.
* **Steam Integration:** Fetches player avatars and profile links directly from the Steam API.
* **Performance:** Intelligent caching with Valkey.
* **Player Analytics:** Utilizes [a fork of Player Analytics](https://github.com/sneak-it/PlayerAnalytics) for **optional** play time display.

## Requirements

* **MySQL** database populated by the ckSurf timer plugin.
* **Valkey** (or Redis). Every query is served through the cache, and when Valkey is unreachable the app serves a "temporarily unavailable" page instead of running uncached queries against your database.
* **A reverse proxy** in front of the app, setting `x-forwarded-for` (or another client-IP header named by `TRUSTED_CLIENT_IP_HEADER`).
* **Node.js >= 24** for a non-Docker deployment (see `.nvmrc`).

## Configuration

The application is configured using environment variables. You can set these in a `.env` file for local development or in your `docker-compose.yml` for production.

### Database Settings

| Env var | Required | Default | Description |
| --- | --- | --- | --- |
| `MYSQL_HOST` | Yes | | MySQL host (e.g. `localhost` or `db`). |
| `MYSQL_PORT` | No | `3306` | MySQL port. |
| `MYSQL_USER` | Yes | | MySQL user. |
| `MYSQL_PASSWORD` | Yes | | MySQL password. |
| `MYSQL_DATABASE` | Yes | | ckSurf database name (usually `cksurf`). |

### Cache (required)

| Env var | Required | Default | Description |
| --- | --- | --- | --- |
| `VALKEY_URL` | No | `redis://localhost:6379` | Connection URL; `redis://valkey:6379` with the example compose file. |
| `VALKEY_USERNAME` | No | | Username, if the server requires auth. |
| `VALKEY_PASSWORD` | No | | Password, if the server requires auth. Required with the example compose file, which sets `requirepass`. |
| `VALKEY_TLS` | No | `false` | `true` to connect over TLS. |
| `VALKEY_TLS_REJECT_UNAUTHORIZED` | No | `true` | `false` to accept self-signed certificates. |
| `VALKEY_CONNECT_TIMEOUT` | No | `5000` | Connection timeout in ms. |

### Player Analytics database (optional)

Powers play-time and activity displays. Requires [the PlayerAnalytics fork](https://github.com/sneak-it/PlayerAnalytics), including its `player_analytics_summary` table; without that table player play-time reads as unavailable.

Analytics is opt-in: it is enabled only when `ANALYTICS_MYSQL_HOST` or `ANALYTICS_MYSQL_DATABASE` is set. Leave both unset and the feature is off, with no connection attempts.

| Env var | Required | Default | Description |
| --- | --- | --- | --- |
| `ANALYTICS_MYSQL_HOST` | No | `MYSQL_HOST` | Analytics DB host. Setting it (or `ANALYTICS_MYSQL_DATABASE`) enables analytics. |
| `ANALYTICS_MYSQL_PORT` | No | `MYSQL_PORT` | Analytics DB port. |
| `ANALYTICS_MYSQL_USER` | No | `MYSQL_USER` | Analytics DB user. |
| `ANALYTICS_MYSQL_PASSWORD` | No | `MYSQL_PASSWORD` | Analytics DB password. |
| `ANALYTICS_MYSQL_DATABASE` | No | `player_analytics_surf` | Analytics DB name. Setting it (or `ANALYTICS_MYSQL_HOST`) enables analytics. |
| `ANALYTICS_HEALTHCHECK_INTERVAL_MS` | No | `60000` | Connection re-check interval in ms; `0` disables, minimum `10000`. |

### Application

| Env var | Required | Default | Description |
| --- | --- | --- | --- |
| `STEAM_API_KEY` | No | | [Steam Web API key](https://steamcommunity.com/dev/apikey). Without it, avatars and Steam names are unavailable. |
| `SERVERS_JSON` | No | | JSON array of game servers for the live status page; each entry needs `name`, `ip`, `port`. Example: `'[{"name":"Main Surf Server","ip":"192.168.1.100","port":27015}]'`. The whole list is ignored (with a logged error) if any entry is malformed. |
| `MAP_IMAGES_URL` | No | GameTracker's image repository | Base URL for map thumbnails. |
| `DISPLAY_TZ` | No | `UTC` | IANA timezone for rendered dates and heatmap buckets. The container's `TZ` must match the database server's for `timestamp` columns to read correctly. |
| `MAX_TIER` | No | `10` | Highest tier shown on the player Tier Distribution radar. |
| `LOG_LEVEL` | No | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent`. |

### Security and limits

| Env var | Required | Default | Description |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Yes | | Canonical public base URL, e.g. `https://stats.example.com` (`http://localhost:3000` locally). Used by the `/api/*` origin guard and for absolute `robots.txt` / `sitemap.xml` / OpenGraph links. Not derived from request headers, which are client-settable. |
| `ALLOWED_ORIGINS` | No | | Comma-separated extra origins allowed to call `/api/*`. The site's own origin is always allowed. |
| `TRUSTED_CLIENT_IP_HEADER` | No | `x-forwarded-for` | Header your proxy sets with the client IP, used for rate-limit keys. Use `cf-connecting-ip` or `true-client-ip` behind a CDN. `x-real-ip` is the fallback when absent. Only name a header your proxy always overwrites. |
| `RATE_LIMIT_MAX` | No | `120` | Max `/api/*` requests per window per IP. |
| `RATE_LIMIT_PAGE_MAX` | No | `300` | Max page requests per window per IP, counted separately from the API budget. |
| `RATE_LIMIT_PREFETCH_MAX` | No | `900` | Max router link prefetches per window per IP. This, not `RATE_LIMIT_PAGE_MAX`, is the effective per-IP ceiling on full page renders, since the scope comes from the client-settable `Sec-Fetch-Dest`. |
| `RATE_LIMIT_WINDOW_SECONDS` | No | `60` | Window length in seconds. |
| `RATE_LIMIT_BLOCK_SECONDS` | No | `0` (disabled) | How long an over-budget IP stays blocked, timed from when it blew the budget and replacing that window's reset. Reported via `Retry-After`. |

`/api/health` is a public liveness probe that returns `{"status":"ok"}` and nothing else. It has no configuration. It deliberately does not check MySQL or Valkey: a failing Docker `HEALTHCHECK` restarts the web container, which cannot fix a database outage and would only flap while the app is otherwise serving its graceful "temporarily unavailable" page. Each dependency has its own healthcheck for that. Note that "healthy" means the process is answering, not that the cache has finished warming.

Rate limiting uses [`rate-limiter-flexible`](https://github.com/animir/node-rate-limiter-flexible) against Valkey, keyed `surfstats:ratelimit:<scope>:<ip>`. If Valkey is unreachable it falls back to an in-process counter with the same budget, so an outage degrades the limiter to per-instance accounting rather than dropping it.

### Database load

| Env var | Required | Default | Description |
| --- | --- | --- | --- |
| `DB_MAX_CONCURRENT_EXPENSIVE` | No | `6` | Max concurrent expensive scans. |
| `DB_MAX_QUEUED_EXPENSIVE` | No | 2x the above | Max callers queued for one of those slots; past it the request is shed with a 503. |
| `DB_CONNECTION_LIMIT` | No | `20` | Max pool connections. |
| `DB_QUEUE_LIMIT` | No | `100` | Max queued connection requests; `0` = unlimited. |
| `DB_CONNECT_TIMEOUT_MS` | No | `5000` | Initial connection timeout in ms. |
| `DB_STATEMENT_TIMEOUT_MS` | No | `8000` | Server-side cap per statement (`max_statement_time` on MariaDB, `max_execution_time` on MySQL); `0` disables. Also bounds the [expensive-query queue](lib/db-semaphore.ts), where a waiter sits behind at most two of these. |
| `PLAYERS_LIST_WARM_PAGES` | No | `10` | Leading players-list pages kept cache-hot. |
| `PLAYERS_LIST_WARM_INTERVAL_MS` | No | `300000` | How often to refresh them, in ms. |

### Site branding

All are optional and public (baked into the client bundle at build time). The required `NEXT_PUBLIC_SITE_URL` is documented under [Security and limits](#security-and-limits).

| Env var | Required | Default | Description |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SITE_TITLE` | No | `SurfStats - CS:GO Surf Community` | Browser tab / metadata title. |
| `NEXT_PUBLIC_SITE_NAME` | No | `SurfStats` | Site name in headings and metadata. |
| `NEXT_PUBLIC_SITE_DESCRIPTION` | No | built-in blurb | Meta description and home page subtitle. |
| `NEXT_PUBLIC_MAIN_SITE_URL` | No | `https://yourdomain.invalid` | Footer link to your community's main site. |
| `NEXT_PUBLIC_MAIN_SITE_NAME` | No | `Main Site` | Text for that link. |
| `NEXT_PUBLIC_FOOTER_LINK_URL` | No | | One extra footer link (e.g. Discord); hidden when unset. |
| `NEXT_PUBLIC_FOOTER_LINK_TEXT` | No | `Link` | Text for that link. |
| `NEXT_PUBLIC_MAP_DOWNLOAD_URL_PREFIX` | No | | Prefix wrapping a map name into a download URL; leave blank to hide the download icon. |
| `NEXT_PUBLIC_MAP_DOWNLOAD_URL_SUFFIX` | No | | Suffix for that URL (e.g. `.bsp.bz2`). |

### Theme

Colors are injected as CSS variables at render time. `THEME_PRIMARY` and `THEME_SECONDARY` set both modes; the per-mode variables override them.

Color families: `emerald`, `green`, `teal`, `cyan`, `sky`, `blue`, `indigo`, `violet`, `purple`, `fuchsia`, `pink`, `rose`, `red`, `orange`, `amber`, `yellow`, `lime`. Background families: `slate`, `gray`, `zinc`, `neutral`, `stone`.

| Env var | Required | Default | Description |
| --- | --- | --- | --- |
| `THEME_PRIMARY` | No | `emerald` | Primary color family, both modes. |
| `THEME_SECONDARY` | No | `cyan` | Secondary color family, both modes. |
| `THEME_LIGHT_PRIMARY` | No | `THEME_PRIMARY` | Primary in light mode. |
| `THEME_LIGHT_SECONDARY` | No | `THEME_SECONDARY` | Secondary in light mode. |
| `THEME_DARK_PRIMARY` | No | `THEME_PRIMARY` | Primary in dark mode. |
| `THEME_DARK_SECONDARY` | No | `THEME_SECONDARY` | Secondary in dark mode. |
| `THEME_LIGHT_BACKGROUND` | No | `gray` | Background family in light mode. |
| `THEME_DARK_BACKGROUND` | No | `zinc` | Background family in dark mode. |

Surface, border, and text colors are derived from the background family. An unrecognized value fails validation at boot.

### AI Disclaimer

This project was developed with AI assistance. All code has been reviewed, best practices adhered to, and security practices have been taken seriously.

## Getting Started

### Using Docker (Recommended)

The easiest way to run the application is using the provided Docker Compose configuration.

1. Clone the repository.
2. Copy `docker-compose.yml.example` to `docker-compose.yml` and `.env.example` to `.env`, then fill in your database credentials, server list, and a `VALKEY_PASSWORD`.
3. Point `VALKEY_URL` at the Valkey service (`redis://valkey:6379`). It is not published to the host.
4. Run the following command to build and start the containers in the background:

```bash
docker compose up -d --build
```

The application listens on port 3000. Put your reverse proxy in front of it (see [Requirements](#requirements)) rather than exposing that port publicly.

### Local Development

If you prefer to run the application directly using Node.js:

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start a Valkey (or Redis) instance the app can reach.
3. Create a `.env.local` file in the root directory and add your configuration variables.
4. Start the development server:
   ```bash
   npm run dev
   ```
5. Open `http://localhost:3000` in your browser.
