import 'server-only';
import client from './valkey';
import logger from './logger';
import {
  getCompletionsOverTimeFromCache,
  getTimeOnMapDataFromCache,
  getCheckpointStatsFromCache,
  getWRCheckpointTimesFromCache,
  getFinishTimeDataFromCache,
  getBonusCompletionsOverTimeFromCache,
  getPercentileTimesFromCache,
} from './valkey-map-stats-cache';
import { getAllMapMetadataFromCache, getMapMetadataFromCache } from './valkey-map-cache';
import { mapKey, MAP_STATS_SUFFIXES, wrCheckpointSuffix } from './cache-keys';
import { getErrorMessage } from './errors';
import { createBackgroundRefresh } from './background-refresh';

// Pacing: all seven series run under the expensive-query semaphore, so keep the
// sweep's share of it small enough that page renders still get connections.
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1_000;
const REFRESH_INTERVAL_MS = 43200_000; // 12 hours
const MAX_CONCURRENT = 2;

/**
 * Refresh all graph data points for a single map from the database.
 * Deletes the cached series first so the *FromCache calls cold-miss and
 * repopulate from the DB (rather than re-extending stale entries), and each
 * call writes its own key — no second write here.
 *
 * Deleted keys use the same suffixes the fetchers do, so a rename can't leave this
 * deleting nothing.
 */
async function precacheMapGraphs(mapname: string): Promise<void> {
  try {
    const metadata = await getMapMetadataFromCache(mapname);
    const checkpoints = metadata?.checkpoints || 0;
    const stages = metadata?.stages || 0;
    const maxCheckpoint = checkpoints > 0 ? checkpoints : stages;

    // Force a fresh DB read on the next fetch.
    await client.del(
      [...Object.values(MAP_STATS_SUFFIXES), wrCheckpointSuffix(maxCheckpoint)].map(suffix =>
        mapKey(mapname, suffix)
      )
    );

    // Each call reads from the DB (cache now empty) and writes its own key.
    await Promise.all([
      getCompletionsOverTimeFromCache(mapname),
      getTimeOnMapDataFromCache(mapname),
      getCheckpointStatsFromCache(mapname),
      getWRCheckpointTimesFromCache(mapname, maxCheckpoint),
      getFinishTimeDataFromCache(mapname),
      getBonusCompletionsOverTimeFromCache(mapname),
      getPercentileTimesFromCache(mapname),
    ]);

    logger.debug(`[MapGraphPrecache] Cached graphs for ${mapname}`);
  } catch (error) {
    logger.warn(`[MapGraphPrecache] Failed to cache graphs for ${mapname}: ${getErrorMessage(error)}`);
  }
}

/**
 * Process a batch of maps for precaching with concurrency limiting.
 * Returns a promise that resolves when the batch is complete.
 */
async function processBatch(mapNames: string[]): Promise<void> {
  // Split into concurrent groups
  const groups: string[][] = [];
  for (let i = 0; i < mapNames.length; i += MAX_CONCURRENT) {
    groups.push(mapNames.slice(i, i + MAX_CONCURRENT));
  }

  // Process each group sequentially, maps within a group run in parallel
  for (const group of groups) {
    await Promise.all(group.map(name => precacheMapGraphs(name)));
  }
}

/**
 * Refresh every map's chart series once, in paced batches. One sweep per interval
 * replaces a ~1,000-timer per-map tree; the batch pacing already spreads the load.
 */
async function precacheAllMapGraphs(): Promise<void> {
  const metadata = await getAllMapMetadataFromCache();
  const mapNames = Array.from(metadata.keys());
  logger.info(`[MapGraphPrecache] Refreshing graphs for ${mapNames.length} maps`);

  for (let i = 0; i < mapNames.length; i += BATCH_SIZE) {
    await processBatch(mapNames.slice(i, i + BATCH_SIZE));

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
  task: precacheAllMapGraphs,
  startupDetail: `every ${REFRESH_INTERVAL_MS / 3600_000}h`,
});

/** Non-blocking: the first sweep runs in the background, then every 12 hours. */
export { startMapGraphPrecache };
