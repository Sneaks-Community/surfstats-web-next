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
* **Performance:** Intelligent caching with 5-minute stats cache and 30-second server status cache for optimal performance.
* **Player Analytics:** Utilizes [a fork of Player Analytics](https://github.com/sneak-it/PlayerAnalytics) for **optional** play time display.

## Configuration

The application is configured using environment variables. You can set these in a `.env` file for local development or in your `docker-compose.yml` for production.

### Database Settings
* `MYSQL_HOST`: Your MySQL database host (e.g., `localhost` or `db`).
* `MYSQL_PORT`: Your MySQL database port (default: `3306`).
* `MYSQL_USER`: Your MySQL database user.
* `MYSQL_PASSWORD`: Your MySQL database password.
* `MYSQL_DATABASE`: The name of your ckSurf database (usually `cksurf`).

### Application Settings
* `STEAM_API_KEY`: Your Steam Web API key, required to fetch player avatars on their profile pages. Get one [here](https://steamcommunity.com/dev/apikey).
* `SERVERS_JSON`: A JSON array defining your game servers for the live status page.
  * Example: `'[{"name":"Main Surf Server","ip":"192.168.1.100","port":27015}]'`
* `MAP_IMAGES_URL`: (Optional) Base URL for fetching map thumbnail images. Defaults to GameTracker's image repository.

### Optional Settings
* `LOG_LEVEL`: Logging verbosity level (default: `warn`). Options: `debug`, `info`, `warn`, `error`.

### AI Disclaimer

This project was developed with AI assistance. All code has been reviewed, best practices adhered to, and security practices have been taken seriously.

## Getting Started

### Using Docker (Recommended)

The easiest way to run the application is using the provided Docker Compose configuration.

1. Clone the repository.
2. Edit the `docker-compose.yml` file to include your specific database credentials and server list.
3. Run the following command to build and start the containers in the background:

```bash
docker compose up -d --build
```

The application will be available at `http://localhost:3000`.

### Local Development

If you prefer to run the application directly using Node.js:

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env.local` file in the root directory and add your configuration variables.
3. Start the development server:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:3000` in your browser.

## Tech Stack

* **Framework:** [Next.js](https://nextjs.org/) 16 (App Router) & [React](https://react.dev/) 19
* **Styling:** [Tailwind CSS](https://tailwindcss.com/) 4 & [Lucide Icons](https://lucide.dev/)
* **Database:** [MySQL2](https://github.com/sidorares/node-mysql2) (Connects directly to your existing ckSurf database)
* **Server Query:** [GameDig](https://github.com/gamedig/node-gamedig) for real-time server status
* **Deployment:** Docker & Docker Compose (Multi-stage Alpine builds for minimal footprint)