import 'server-only';
import logger from './logger';
import { createBackgroundRefresh } from './background-refresh';
import { CacheUnavailableError, getErrorMessage } from './errors';
import {
  getDashboardStatsFromCache,
  getRecentRecordsFromCache,
  getLatestCompletionsFromCache,
} from './dashboard-cache';
import {
  getAllMapMetadataFromCache,
  getTierDistributionFromCache,
  getTotalsFromCache,
} from './map-cache';
import { getAllRegistryDataFromCache } from './registry-cache';
import { getCountriesRankingFromCache } from './country-cache';
import {
  getPlayerOverviewFromCache,
  getPlayerWrPerformanceFromCache,
  getLinearVsStagedPerTierFromCache,
} from './player-profile-cache';
import {
  getPlayerTimeOnServerFromCache,
  getActivityHeatmapFromCache,
  getPlayerMapEngagementFromCache,
} from './player-analytics';
import { listRecentProfiles } from './recent-profiles';
import { fetchServersFromGame } from './server-status';
import { cacheSet } from './valkey-cache';
import { SERVER_CACHE_KEY, SERVER_CACHE_TTL } from './cache-keys';
import { warmPlayersListCache } from './player-cache';
import { getEnv } from './env';

// Every recurring cache refresh. Cadence is per domain since a pass costs keys / interval (one-key
// caches run every minute, the 250-country slice can't). Tasks refresh in place (`force`), never
// `DEL`, so a failed pass keeps serving the old value.
const SERVERS_INTERVAL_MS = 30_000;
const DASHBOARD_INTERVAL_MS = 60_000;
const TOTALS_INTERVAL_MS = 300_000; // 5 minutes
const STATIC_INTERVAL_MS = 1_800_000; // 30 minutes
const COUNTRIES_INTERVAL_MS = 21_600_000; // 6 hours
const PROFILES_INTERVAL_MS = 900_000; // 15 minutes

// Rankings change slowly, so a few-minute interval keeps the browsed pages fresh.
const { PLAYERS_LIST_WARM_PAGES, PLAYERS_LIST_WARM_INTERVAL_MS } = getEnv();

const force = { force: true } as const;

const refreshers = [
  createBackgroundRefresh({
    name: 'ServerRefresh',
    intervalMs: SERVERS_INTERVAL_MS,
    task: async () => {
      const servers = await fetchServersFromGame();
      await cacheSet(SERVER_CACHE_KEY, servers, SERVER_CACHE_TTL);
      logger.debug(`[ServerRefresh] Cached ${servers.length} servers with TTL ${SERVER_CACHE_TTL}s`);
    },
  }),
  createBackgroundRefresh({
    name: 'PlayersListRefresh',
    intervalMs: PLAYERS_LIST_WARM_INTERVAL_MS,
    startupDetail: `${PLAYERS_LIST_WARM_PAGES} pages every ${PLAYERS_LIST_WARM_INTERVAL_MS}ms`,
    task: async () => {
      await warmPlayersListCache(PLAYERS_LIST_WARM_PAGES);
      logger.debug(`[PlayersListRefresh] Warmed first ${PLAYERS_LIST_WARM_PAGES} players-list pages`);
    },
  }),
  createBackgroundRefresh({
    name: 'DashboardRefresh',
    intervalMs: DASHBOARD_INTERVAL_MS,
    task: async () => {
      await Promise.all([
        getDashboardStatsFromCache(force),
        getRecentRecordsFromCache(force),
        getLatestCompletionsFromCache(force),
      ]);
    },
  }),
  createBackgroundRefresh({
    name: 'TotalsRefresh',
    intervalMs: TOTALS_INTERVAL_MS,
    task: async () => {
      await getTotalsFromCache(force);
    },
  }),
  createBackgroundRefresh({
    name: 'StaticCacheRefresh',
    intervalMs: STATIC_INTERVAL_MS,
    startupDetail: 'map metadata + registry',
    task: async () => {
      // Metadata first: the tier distribution is derived from that key.
      await getAllMapMetadataFromCache(force);
      await Promise.all([getTierDistributionFromCache(force), getAllRegistryDataFromCache(force)]);
    },
  }),
  createBackgroundRefresh({
    name: 'CountriesRefresh',
    intervalMs: COUNTRIES_INTERVAL_MS,
    task: async () => {
      await getCountriesRankingFromCache(force);
    },
  }),
  createBackgroundRefresh({
    name: 'RecentProfilesRefresh',
    intervalMs: PROFILES_INTERVAL_MS,
    task: ({ startup }) => warmRecentProfiles(startup),
  }),
];

// The keys a profile page's server render awaits; tab data stays on demand.
async function refreshProfile(steamid: string, startup: boolean): Promise<void> {
  // Startup reads first (skipping profiles within their 1h TTL); interval sweeps force.
  const opts = { force: !startup };
  await Promise.all([
    getPlayerOverviewFromCache(steamid, opts),
    getPlayerWrPerformanceFromCache(steamid, opts),
    getLinearVsStagedPerTierFromCache(steamid, opts),
    getPlayerTimeOnServerFromCache(steamid, opts),
    getActivityHeatmapFromCache(steamid, opts),
    getPlayerMapEngagementFromCache(steamid, opts),
  ]);
}

// Recently viewed profiles, one at a time (each profile's fetches already run in parallel), to
// keep the sweep off the expensive-query semaphore page renders share.

async function warmRecentProfiles(startup: boolean): Promise<void> {
  const steamids = await listRecentProfiles();
  if (steamids.length === 0) return;

  for (const steamid of steamids) {
    try {
      await refreshProfile(steamid, startup);
    } catch (error) {
      if (error instanceof CacheUnavailableError) throw error;
      logger.warn(`[RecentProfilesRefresh] Failed to warm ${steamid}: ${getErrorMessage(error)}`);
    }
  }

  logger.debug(`[RecentProfilesRefresh] Warmed ${steamids.length} recently viewed profiles`);
}

/** Non-blocking; each refresher's first run is also its cache warm. */

export function startCacheRefreshers(): void {
  refreshers.forEach(({ start }) => { start(); });
}
