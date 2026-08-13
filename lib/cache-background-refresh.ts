import 'server-only';
import logger from './logger';
import { createBackgroundRefresh } from './background-refresh';
import { getErrorMessage } from './errors';
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
import { getCountriesRankingFromCache, getCountriesStatsFromCache } from './country-cache';
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

/**
 * The caches that used to be warmed once at boot and then left to expire, plus the
 * recently-viewed profile set. Cadence is per domain because the cost of a pass is
 * (number of keys / interval): the volatile single-key caches are cheap enough to
 * run every minute, the 250-country slice is not.
 *
 * Every task refreshes in place (`force`), never `DEL`, so a pass can only ever
 * make a page faster, and a failed pass leaves the previous value being served.
 */
const DASHBOARD_INTERVAL_MS = 60_000;
const TOTALS_INTERVAL_MS = 300_000; // 5 minutes
const STATIC_INTERVAL_MS = 1_800_000; // 30 minutes
const COUNTRIES_INTERVAL_MS = 21_600_000; // 6 hours
const PROFILES_INTERVAL_MS = 900_000; // 15 minutes

const force = { force: true } as const;

const refreshers = [
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
      await Promise.all([
        getCountriesRankingFromCache(force),
        getCountriesStatsFromCache(force),
      ]);
    },
  }),
  createBackgroundRefresh({
    name: 'RecentProfilesRefresh',
    intervalMs: PROFILES_INTERVAL_MS,
    task: ({ startup }) => warmRecentProfiles(startup),
  }),
];

/** The six keys a profile page's server render awaits. The tab data stays on demand. */
async function refreshProfile(steamid: string, startup: boolean): Promise<void> {
  // Startup reads first (skip profiles still within their 1h TTL); interval
  // sweeps force an in-place refresh.
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

/**
 * Refresh the recently-viewed profiles, one at a time: the six fetches per profile
 * are already parallel, and pacing at one profile keeps the sweep off the
 * expensive-query semaphore that page renders share.
 */
async function warmRecentProfiles(startup: boolean): Promise<void> {
  const steamids = await listRecentProfiles();
  if (steamids.length === 0) return;

  for (const steamid of steamids) {
    try {
      await refreshProfile(steamid, startup);
    } catch (error) {
      logger.warn(`[RecentProfilesRefresh] Failed to warm ${steamid}: ${getErrorMessage(error)}`);
    }
  }

  logger.debug(`[RecentProfilesRefresh] Warmed ${steamids.length} recently viewed profiles`);
}

/** Non-blocking: each refresher runs once immediately, which is also its warm. */
export function startCacheRefreshers(): void {
  refreshers.forEach(({ start }) => { start(); });
}
