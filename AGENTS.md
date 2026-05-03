# SurfStats Web - AI Agent Guidelines

---

## Project Overview

**SurfStats** is a modern, fast, and responsive web interface for displaying player statistics, map records, and live server status for CS:GO surf servers running the ckSurf timer plugin.

## Timer Information

**ckSurf** is a timer application for speed running maps in CS:GO. It tracks player times, across Maps, Bonuses, and Stages. There are two types of maps - Linear, and Staged. Linear maps have checkpoints, which records time at certain intervals inside of Linear maps. Staged maps have stages, which work similar to checkpoints, with the exception of the ability to restart at any stage within the map. As a player completes a map, stages are recorded similarly to checkpoints. Bonuses do not have checkpoints or stages.

Stage definitions are stored in the `ck_zones` table. There are 3 key columns to make note of which are utilized throughout the project - `zonetype`, `zonegroup`, and `zonetypeid`. Here are their definitions:

- Zonetype 1: Start
- Zonetype 2: End
- Zonetype 3: Stage
- Zonetype 4: Checkpoint

- Zonegroup 0: Map
- Zonegroup >= 1: Bonus

For example, zonetype 1 in zonegroup 0 is the start zone of the map. Zonetype 1 in zonegroup 2 is the start zone for Bonus 2. Zonetype 2 in Zonegroup 4 is the end zone for Bonus 4.

The `zonetypeid` column is what determines the order of stages in the zone structure. For example, zonetypeid = 0 with zonetype = 3 is Stage 1. Zonetypeid = 4 with zonetype = 3 is Stage 5. Zonetypeid is not utilized in this project for anything other than stages counting.

### Key Features

- **Dashboard**: Real-time statistics (players, completions, points, recent records)
- **Player Leaderboards**: Top players by points or finished maps with pagination
- **Player Profiles**: Individual player pages with Steam integration (avatars, country flags)
- **Country Analytics**: Player distribution by country with tier breakdowns
- **Map Records**: Browse maps with filtering (search, type, bonus count, difficulty tier)
- **Map Details**: Completion times, bonus records, stage times, checkpoint charts
- **Live Server Status**: Real-time server monitoring with player lists (30s background refresh)
- **Global Search**: Search players by name/SteamID and maps
- **Latest Completions**: Feed of recent map and bonus completions

---

## Technology Stack

This project utilizes the latest minor versions of the following:

- **Next.js 16** (App Router) + **React 19**
- **TypeScript 5** - Strict mode enabled
- **Tailwind CSS 4** - Theme-aware classes only
- **MySQL2 3** - Database driver
- **Pino 9** - Structured JSON logging
- **Steam Web API** - Player avatars and profile data
- **Chart.js 4** + **react-chartjs-2 5** - Data visualization
- **GameDig 5** - Game server querying
- **Lucide React 1** - Icon library
- **Country Flag Icons 1** - Country flag display
- **server-only 0.0.1** - Server-only module imports

---

## Project Structure

```
/projects/surfstatsweb-next/
├── app/                          # Next.js App Router
│   ├── api/                      # API routes
│   │   ├── completions/          # Latest completions endpoint
│   │   ├── maps/
│   │   │   └── [mapname]/        # Map-specific endpoints
│   │   │       ├── bonuses/      # Bonus records
│   │   │       ├── records/      # Map leaderboard
│   │   │       ├── stages/       # Stage times
│   │   │       └── stats/        # Map statistics
│   │   └── search/               # Global search endpoint
│   ├── maps/                     # Maps listing and details pages
│   │   └── [mapname]/
│   │       └── components/       # Map detail components
│   │           └── charts/       # Chart components
│   ├── players/                  # Players listing and profiles
│   │   ├── [steamid]/            # Player profile page
│   │   │   └── components/       # Player components
│   │   └── countries/            # Country analytics
│   │       └── [countrycode]/    # Country detail page
│   ├── search/                   # Search results page
│   ├── servers/                  # Live server status page
│   └── search/                   # Search results page
├── components/                   # Shared UI components (navigation, search, filters, badges, pagination)
├── hooks/                        # Custom React hooks (mobile detection, debouncing, pagination state)
├── lib/                          # Utility libraries (database, caching, analytics, Steam API, utilities)
├── public/                       # Static assets
├── types/                        # TypeScript type definitions
└── .env.example                  # Environment variable template
```

---

## Development Guidelines

### 1. Server Components First

Default to server components. Only use client components when interactivity is required (marked with `'use client'`).

**Examples:**
- Server components: API routes, data fetching pages, map details
- Client components: Navigation, search dropdown, theme toggle, pagination, charts

### 2. Database Access

Use centralized connection pools from [`lib/db.ts`](lib/db.ts) and [`lib/db-analytics.ts`](lib/db-analytics.ts):

- **Main database** (`surf85`): Player stats, map records, server data
- **Analytics database** (`player_analytics_surf`): Optional server connection tracking

Both pools use [`wrapPoolQuery`](lib/db-query-logger.ts) for slow query logging.

### 3. Caching Strategy

The application uses **Valkey (Redis-compatible)** for all caching needs with a **cache-aside pattern**. The `redis` npm package (v5.12.1) is used as a Valkey-compatible client.

Valkey connection client is located at [`lib/valkey.ts`](lib/valkey.ts), with other caches in the `lib` folder.

**Important**: All cache keys use the `surfstats:` namespace prefix for consistency. Keys are validated using [`validateMapName()`](lib/validators.ts) and [`validateSearchQuery()`](lib/validators.ts) before use.

#### Browser/CDN Cache
HTTP caching headers on API responses.

### 4. Error Handling

Wrap async operations in try-catch blocks with Pino logging:

```typescript
async function getStats() {
  try {
    const stats = await getStatsCached();
    logger.debug('[Home] Stats loaded successfully');
    return stats;
  } catch (error: any) {
    logger.error(`[Home] Failed to load stats: ${error.message}`);
    return null; // Return fallback for graceful degradation
  }
}
```

### 5. Security

- Use [`validateMapName()`](lib/validators.ts) for all map name inputs
- Use [`validateSteamId()`](lib/validators.ts) for SteamID validation
- Use [`validateSearchQuery()`](lib/validators.ts) for search inputs
- Use [`validatePlayerName()`](lib/validators.ts) for player name display
- Use parameterized queries for all database operations (mysql2 promise API)
- Import `'server-only'` for modules that should never run on the client

### 6. Input Validation

All input validation uses [Zod v4](https://zod.dev) schemas defined in [`lib/validators.ts`](lib/validators.ts). The library provides TypeScript-first schema validation with built-in sanitization (trim, regex, XSS removal, SQL LIKE wildcard escaping). Never write custom sanitization logic - always use the exported validator functions.
- Import `'server-only'` for modules that should never run on the client

### 6. Logging

Use Pino logger with module prefixes:

```typescript
import logger from '@/lib/logger';

logger.debug(`[Steam] Fetching avatar for ${steamId}`);
logger.error(`[DB] Query failed: ${error.message}`);
logger.info('[ServerCache] Background refresh complete');
```

**Log levels**: Configurable via `LOG_LEVEL` env var (default: 'warn')
**Output**: Structured JSON (pipe through `pino-pretty` in development)

### 7. TypeScript

- Define interfaces for all data structures
- Extend `RowDataPacket` for database query results
- Use type guards for runtime type checking

### 8. Theme System

Use theme-aware Tailwind classes only:

- `text-text`, `text-text-muted`, `text-text-placeholder`
- `bg-surface`, `bg-surface-hover`, `bg-background-secondary`
- `border-border`

Refer to [`lib/theme-config.ts`](lib/theme-config.ts) for available CSS custom properties. Theme colors are injected at runtime via CSS variables (`--color-background`, `--color-primary`, etc.).

**Configuration**: Set via environment variables:
- `THEME_COLOR_FAMILY`: Primary color (emerald, blue, purple, etc.)
- `THEME_BACKGROUND_FAMILY`: Background color (slate, zinc, stone, etc.)

### 9. Responsive Design

Mobile and desktop view compatibility is critical:

- Design mobile-first, enhance for larger screens
- Use Tailwind breakpoints: `sm:`, `md:`, `lg:`, `xl:`, `2xl:`
- Touch targets: minimum 44x44px on mobile
- Horizontal scrolling for tables on mobile
- Collapsible/accordion patterns for complex layouts
- Hamburger menu for mobile navigation

### 10. Light and Dark Mode

- Use `dark:` prefix for dark mode variants
- Test UI in both modes
- Sufficient contrast ratios (WCAG AA: 4.5:1 for text)
- Avoid relying solely on color to convey information
- Theme toggle persists via localStorage

---

## Database Schema

The application works with the ckSurf database schema (surf85) and optional analytics database (player_analytics_surf):

### Main Database Tables (surf85)

| Table | Description |
|-------|-------------|
| **ck_maptier** | Map metadata (mapname, tier, btier1-10, mapper, mappersteam) |
| **ck_playertimes** | Player completion times (steamid, mapname, name, runtimepro, startspeed, date) |
| **ck_bonus** | Bonus zone completions (steamid, mapname, runtime, zonegroup, startspeed, date) |
| **ck_stages** | Stage completion times (steamid, map, stage, runtime, date, startspeed) |
| **ck_zones** | Zone definitions (mapname, zoneid, zonetype, pointa/b, zonegroup, zonename, hookname) |
| **ck_stats** | Global statistics cache (key, value, last_updated) |
| **ck_playerrank** | Player rankings (steamid, name, country, points, finishedmaps, lastseen) |
| **ck_checkpoints** | Checkpoint times (steamid, mapname, cp1-cp75, zonegroup) |
| **ck_latestrecords** | Latest records cache (steamid, name, runtime, map, date) |
| **ck_playeroptions** | Player settings (steamid, speedmeter, quake_sounds, etc.) |
| **ck_playertitles** | Player titles/flags (steamid, vip, mapper, teacher, custom1-20) |
| **ck_challenges** | Challenge bets (steamid, steamid2, bet, map, date) |

### Analytics Database (Optional - player_analytics_surf)

| Table | Description |
|-------|-------------|
| **player_analytics** | Server connection data (id, server_ip, name, steamid3, connect_time, connect_date, map, duration, country, country_code, os) |

Uses separate connection pool from main database with graceful fallback if unavailable.

---

## Testing and Verification

Before completing a task:

1. **Run lint**: `npm run lint` - Check for TypeScript errors and code style issues
2. **Run build**: `npm run build` - Ensure production build succeeds

**IMPORTANT**: Always run `npm run lint` and `npm run build` before completing a task to ensure code quality. If there are any warnings or errors, they should be resolved and fixed.

---

## Code Quality Standards

- **No hardcoded colors**: Always use theme-aware classes
- **No direct database queries in components**: Use API routes or cached functions
- **No console.log**: Use Pino logger with appropriate log levels
- **No untyped variables**: Define interfaces for all data structures
- **No unhandled promises**: Always await async operations with try-catch
- **No direct imports from `node_modules` in client components**: Use `server-only` for server-only modules
- **Reuse existing code**: Use existing functions, queries, and caches if available; do not implement new queries without checking if the requested data already exists
- **Optimization first**: Follow a "less is more" approach; ensure all code and queries are as efficient as possible