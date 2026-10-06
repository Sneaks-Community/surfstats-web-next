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

// One series per map at a time, so the sweep holds at most MAX_CONCURRENT of the semaphore's
// 6 slots, never queues behind itself, and leaves the rest for page renders.
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1_000;
const REFRESH_INTERVAL_MS = 86400_000; // 24 hours
const MAX_CONCURRENT = 2;

/**
 * Refreshes one map's chart series in place (no `DEL` first), so a visitor never finds a key
 * missing and pays for the query, and a failed refresh keeps serving the previous value.
 */
async function precacheMapGraphs(mapname: string, startup: boolean): Promise<void> {
  try {
    const metadata = await getMapMetadataFromCache(mapname);
    const checkpoints = metadata?.checkpoints || 0;
    const stages = metadata?.stages || 0;
    const maxCheckpoint = checkpoints > 0 ? checkpoints : stages;

    // Startup skips series still within their 72h TTL; interval sweeps force an in-place refresh.
    const force = { force: !startup };
    // Sequential: measured ~300ms per map either way, and six copies of one aggregate run 2.75x
    // slower fanned out, so fan-out only lengthens the sweep's hold on the semaphore.
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
    // A dropped cache fails every map identically: abort so it's logged once, not per map.
    if (error instanceof CacheUnavailableError) throw error;
    logger.warn(`[MapGraphPrecache] Failed to cache graphs for ${mapname}: ${getErrorMessage(error)}`);
  }
}

/** Refreshes every map's chart series once per interval, in paced batches to spread the load. */
async function precacheAllMapGraphs(startup: boolean): Promise<void> {
  const metadata = await getAllMapMetadataFromCache();
  const mapNames = Array.from(metadata.keys());
  logger.info(`[MapGraphPrecache] Refreshing graphs for ${mapNames.length} maps`);

  for (let i = 0; i < mapNames.length; i += MAX_CONCURRENT) {
    if (i > 0 && i % BATCH_SIZE === 0) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
    await Promise.all(mapNames.slice(i, i + MAX_CONCURRENT).map(name => precacheMapGraphs(name, startup)));
  }

  logger.info(`[MapGraphPrecache] Precache complete for ${mapNames.length} maps`);
}

const { start: startMapGraphPrecache } = createBackgroundRefresh({
  name: 'MapGraphPrecache',
  intervalMs: REFRESH_INTERVAL_MS,
  task: ({ startup }) => precacheAllMapGraphs(startup),
  startupDetail: `every ${REFRESH_INTERVAL_MS / 3600_000}h`,
});

/** Non-blocking: the first sweep runs in the background, then every 24 hours. */
export { startMapGraphPrecache };
