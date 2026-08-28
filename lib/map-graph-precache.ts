import 'server-only';
import logger from './logger';
import {
  getCompletionsOverTimeFromCache,
  getTimeOnMapDataFromCache,
  getCheckpointStatsFromCache,
  getWRCheckpointTimesFromCache,
  getBonusCompletionsOverTimeFromCache,
  getPercentileTimesFromCache,
} from './map-stats-cache';
import { getAllMapMetadataFromCache, getMapMetadataFromCache } from './map-cache';
import { CacheUnavailableError, getErrorMessage } from './errors';
import { createBackgroundRefresh } from './background-refresh';

// Pacing: the series run under the expensive-query semaphore, one at a time per
// map, so the whole sweep holds at most MAX_CONCURRENT of its 6 slots and never
// queues behind itself, leaving the rest for page renders.
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1_000;
const REFRESH_INTERVAL_MS = 43200_000; // 12 hours
const MAX_CONCURRENT = 2;

/**
 * Refresh all graph data points for a single map from the database, one series at
 * a time. Each series is refreshed in place: no `DEL` first, so there is no window
 * where a visitor finds the key missing and pays for the query, and a failed
 * refresh leaves the previous value being served.
 */
async function precacheMapGraphs(mapname: string, startup: boolean): Promise<void> {
  try {
    const metadata = await getMapMetadataFromCache(mapname);
    const checkpoints = metadata?.checkpoints || 0;
    const stages = metadata?.stages || 0;
    const maxCheckpoint = checkpoints > 0 ? checkpoints : stages;

    // Startup reads first (skip series still within their 36h TTL); interval
    // sweeps force an in-place refresh.
    const force = { force: !startup };
    // One series at a time: measured on this DB, the six run no faster in
    // parallel (~300ms per map either way) and six copies of one aggregate are
    // 2.75x slower fanned out, so the fan-out only widened the sweep's hold on
    // the expensive-query semaphore.
    for (const series of [
      () => getCompletionsOverTimeFromCache(mapname, force),
      () => getTimeOnMapDataFromCache(mapname, force),
      () => getCheckpointStatsFromCache(mapname, force),
      () => getWRCheckpointTimesFromCache(mapname, maxCheckpoint, force),
      () => getBonusCompletionsOverTimeFromCache(mapname, force),
      () => getPercentileTimesFromCache(mapname, force),
    ]) {
      await series();
    }

    logger.debug(`[MapGraphPrecache] Cached graphs for ${mapname}`);
  } catch (error) {
    // A dropped cache fails every map identically and the sweep can't do any
    // work without it: abort so it's logged once, not ~1,000 times.
    if (error instanceof CacheUnavailableError) throw error;
    logger.warn(`[MapGraphPrecache] Failed to cache graphs for ${mapname}: ${getErrorMessage(error)}`);
  }
}

/**
 * Process a batch of maps for precaching with concurrency limiting.
 * Returns a promise that resolves when the batch is complete.
 */
async function processBatch(mapNames: string[], startup: boolean): Promise<void> {
  // Split into concurrent groups
  const groups: string[][] = [];
  for (let i = 0; i < mapNames.length; i += MAX_CONCURRENT) {
    groups.push(mapNames.slice(i, i + MAX_CONCURRENT));
  }

  // Process each group sequentially, maps within a group run in parallel
  for (const group of groups) {
    await Promise.all(group.map(name => precacheMapGraphs(name, startup)));
  }
}

/**
 * Refresh every map's chart series once, in paced batches. One sweep per interval
 * replaces a ~1,000-timer per-map tree; the batch pacing already spreads the load.
 */
async function precacheAllMapGraphs(startup: boolean): Promise<void> {
  const metadata = await getAllMapMetadataFromCache();
  const mapNames = Array.from(metadata.keys());
  logger.info(`[MapGraphPrecache] Refreshing graphs for ${mapNames.length} maps`);

  for (let i = 0; i < mapNames.length; i += BATCH_SIZE) {
    await processBatch(mapNames.slice(i, i + BATCH_SIZE), startup);

    // Delay between batches (except after the last one)
    if (i + BATCH_SIZE < mapNames.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  logger.info(`[MapGraphPrecache] Precache complete for ${mapNames.length} maps`);
}

const { start: startMapGraphPrecache } = createBackgroundRefresh({
  name: 'MapGraphPrecache',
  intervalMs: REFRESH_INTERVAL_MS,
  task: ({ startup }) => precacheAllMapGraphs(startup),
  startupDetail: `every ${REFRESH_INTERVAL_MS / 3600_000}h`,
});

/** Non-blocking: the first sweep runs in the background, then every 12 hours. */
export { startMapGraphPrecache };
