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

* `MYSQL_HOST`: Your MySQL database host (e.g., `localhost` or `db`).
* `MYSQL_PORT`: Your MySQL database port (default: `3306`).
* `MYSQL_USER`: Your MySQL database user.
* `MYSQL_PASSWORD`: Your MySQL database password.
* `MYSQL_DATABASE`: The name of your ckSurf database (usually `cksurf`).

### Cache (required)

* `VALKEY_URL`: Connection URL (default: `redis://localhost:6379`; `redis://valkey:6379` with the example compose file).
* `VALKEY_USERNAME` / `VALKEY_PASSWORD`: Credentials, if the server requires auth. The example compose file sets `requirepass`, so `VALKEY_PASSWORD` is required there.
* `VALKEY_TLS`: Set to `true` to connect over TLS.
* `VALKEY_TLS_REJECT_UNAUTHORIZED`: Set to `false` to accept self-signed certificates.
* `VALKEY_CONNECT_TIMEOUT`: Connection timeout in ms (default: `5000`).

### Player Analytics database (optional)

Powers play-time and activity displays. Requires [the PlayerAnalytics fork](https://github.com/sneak-it/PlayerAnalytics), including its `player_analytics_summary` table; without that table player play-time reads as unavailable.

Analytics is opt-in: it is enabled only when `ANALYTICS_MYSQL_HOST` or `ANALYTICS_MYSQL_DATABASE` is set. Leave both unset and the feature is off, with no connection attempts. The remaining `ANALYTICS_MYSQL_*` values fall back to their `MYSQL_*` counterparts, so pointing at a second database on the same server needs only `ANALYTICS_MYSQL_DATABASE`.

* `ANALYTICS_MYSQL_HOST`, `ANALYTICS_MYSQL_PORT`, `ANALYTICS_MYSQL_USER`, `ANALYTICS_MYSQL_PASSWORD`, `ANALYTICS_MYSQL_DATABASE`
* `ANALYTICS_HEALTHCHECK_INTERVAL_MS`: How often to re-check the connection, in ms (default: `60000`; `0` disables).

### Application

* `STEAM_API_KEY`: Your Steam Web API key, required to fetch player avatars and names. Get one [here](https://steamcommunity.com/dev/apikey). Without it, avatars and Steam names are unavailable.
* `SERVERS_JSON`: A JSON array defining your game servers for the live status page. Each entry needs `name`, `ip`, and `port`; the whole list is ignored (with a logged error) if any entry is malformed.
  * Example: `'[{"name":"Main Surf Server","ip":"192.168.1.100","port":27015}]'`
* `MAP_IMAGES_URL`: Base URL for map thumbnails. Defaults to GameTracker's image repository.
* `DISPLAY_TZ`: IANA timezone for every rendered date and for the activity heatmap's day/hour buckets (default: `UTC`). Boot fails with a clear error if the zone is unknown to the runtime. Note the MySQL driver reads `timestamp` columns using the *container's* `TZ`, so for dates to render correctly the container's timezone must match the database server's (both UTC by default). `DISPLAY_TZ` then chooses what is shown.
* `MAX_TIER`: Highest tier shown on the player Tier Distribution radar (default: `10`). Caps the axes so a junk placeholder tier doesn't distort the chart.
* `LOG_LEVEL`: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent` (default: `warn`).

### Security and limits

* `ALLOWED_ORIGINS`: Comma-separated extra origins allowed to call `/api/*`. The site's own origin is always allowed.
* `TRUSTED_CLIENT_IP_HEADER`: Header your proxy sets with the client IP, used for rate-limit keys (default: `x-forwarded-for`). Set it to `cf-connecting-ip` (or `true-client-ip`) when a CDN, not your local proxy, is the trust boundary; otherwise the right-most `x-forwarded-for` hop is the CDN edge and every visitor shares one rate-limit bucket. `x-real-ip` is used as a fallback when the named header is absent, and a missing header is logged once per process at `warn`. Only set this to a header your proxy always overwrites, since a client can send any header it likes.
* `RATE_LIMIT_MAX`: Max `/api/*` requests per window per IP (default: `120`).
* `RATE_LIMIT_PAGE_MAX`: Max page requests per window per IP (default: `300`). Counted separately from the API budget.
* `RATE_LIMIT_PREFETCH_MAX`: Max router link prefetches per window per IP (default: `900`). Own budget, since one page view prefetches every viewport `<Link>`.
* `RATE_LIMIT_WINDOW_SECONDS`: Window length in seconds (default: `60`).
* `RATE_LIMIT_BLOCK_SECONDS`: Extra seconds an over-budget IP stays blocked past the end of its window (default: `0`, disabled). Use it to make sustained abuse expensive without lowering the budget for everyone.
`/api/health` is a public liveness probe that returns `{"status":"ok"}` and nothing else. It has no configuration. It deliberately does not check MySQL or Valkey: a failing Docker `HEALTHCHECK` restarts the web container, which cannot fix a database outage and would only flap while the app is otherwise serving its graceful "temporarily unavailable" page. Each dependency has its own healthcheck for that. Note that "healthy" means the process is answering, not that the cache has finished warming.

Rate limiting uses [`rate-limiter-flexible`](https://github.com/animir/node-rate-limiter-flexible) against Valkey, keyed `surfstats:ratelimit:<scope>:<ip>`. If Valkey is unreachable it falls back to an in-process counter with the same budget, so an outage degrades the limiter to per-instance accounting rather than dropping it.

### Database load

* `DB_MAX_CONCURRENT_EXPENSIVE`: Max concurrent expensive scans, so a burst can't starve page rendering (default: `6`).
* `DB_MAX_QUEUED_EXPENSIVE`: Max callers queued for one of those slots; past it the request is shed with a 503 (default: twice the above).
* `DB_CONNECTION_LIMIT`: Max pool connections (default: `20`).
* `DB_QUEUE_LIMIT`: Max queued connection requests; `0` = unlimited (default: `100`).
* `DB_CONNECT_TIMEOUT_MS`: Initial connection timeout in ms (default: `5000`).
* `DB_STATEMENT_TIMEOUT_MS`: Server-side cap per statement, applied to every pooled connection (`max_statement_time` on MariaDB, `max_execution_time` on MySQL). A query that exceeds it is killed and its connection released, instead of running on after the client has given up; `0` disables (default: `30000`).
* `PLAYERS_LIST_WARM_PAGES`: Leading players-list pages kept cache-hot (default: `10`).
* `PLAYERS_LIST_WARM_INTERVAL_MS`: How often to refresh them, in ms (default: `300000`).

### Site branding

All are optional and public (baked into the client bundle at build time).

* `NEXT_PUBLIC_SITE_TITLE`, `NEXT_PUBLIC_SITE_NAME`, `NEXT_PUBLIC_SITE_DESCRIPTION`
* `NEXT_PUBLIC_SITE_URL`: Canonical public base URL, used for absolute `robots.txt` / `sitemap.xml` links. Falls back to the request host.
* `NEXT_PUBLIC_MAIN_SITE_URL`, `NEXT_PUBLIC_MAIN_SITE_NAME`: Link back to your community's main site.
* `NEXT_PUBLIC_FOOTER_LINK_URL`, `NEXT_PUBLIC_FOOTER_LINK_TEXT`: One extra footer link (e.g. Discord).
* `NEXT_PUBLIC_MAP_DOWNLOAD_URL_PREFIX`, `NEXT_PUBLIC_MAP_DOWNLOAD_URL_SUFFIX`: Wrap a map name into a download URL. Leave the prefix blank to hide the download icon.

### Theme

Colors are injected as CSS variables at render time. `THEME_PRIMARY` and `THEME_SECONDARY` set both modes; the per-mode variables override them.

* `THEME_PRIMARY` (default: `emerald`), `THEME_SECONDARY` (default: `cyan`)
* `THEME_LIGHT_PRIMARY`, `THEME_LIGHT_SECONDARY`, `THEME_DARK_PRIMARY`, `THEME_DARK_SECONDARY`
  * Any of: `emerald`, `green`, `teal`, `cyan`, `sky`, `blue`, `indigo`, `violet`, `purple`, `fuchsia`, `pink`, `rose`, `red`, `orange`, `amber`, `yellow`, `lime`
* `THEME_LIGHT_BACKGROUND` (default: `gray`), `THEME_DARK_BACKGROUND` (default: `zinc`)
  * Any of: `slate`, `gray`, `zinc`, `neutral`, `stone`

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
