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
import { getErrorMessage } from './errors';
import { onShutdown } from './shutdown';

// Configuration
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 50;
const REFRESH_INTERVAL_MS = 43200_000; // 12 hours
const REFRESH_JITTER_MS = 300_000; // +/- 5 minutes jitter
const MAX_CONCURRENT = 5;

// Refresh timers per map (for background refresh)
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Guards startMapGraphPrecache against re-running if the module re-initializes.
let precacheStarted = false;

/**
 * Fetch and cache all 8 graph data points for a single map using Valkey pipelining.
 * Uses pipeline() to batch all SET operations into a single network round-trip.
 */
async function precacheMapGraphs(mapname: string): Promise<void> {
  try {
    const metadata = await getMapMetadataFromCache(mapname);
    const checkpoints = metadata?.checkpoints || 0;
    const stages = metadata?.stages || 0;
    const maxCheckpoint = checkpoints > 0 ? checkpoints : stages;

    // Fetch all 8 data points in parallel
    const [
      completionsOverTime,
      timeOnMapData,
      checkpointStats,
      wrCheckpointTimes,
      finishTimeData,
      bonusCompletionsOverTime,
      percentileTimes,
    ] = await Promise.all([
      getCompletionsOverTimeFromCache(mapname),
      getTimeOnMapDataFromCache(mapname),
      getCheckpointStatsFromCache(mapname),
      getWRCheckpointTimesFromCache(mapname, maxCheckpoint),
      getFinishTimeDataFromCache(mapname),
      getBonusCompletionsOverTimeFromCache(mapname),
      getPercentileTimesFromCache(mapname),
    ]);

    // Use Valkey pipelining for batch SET operations (single network round-trip)
    // redis v5 client: use Promise.all() with individual setEx calls
    // This batches commands efficiently within the same event loop tick
    const TTL = 43200; // 12 hours

    await Promise.all([
      client.setEx(`surfstats:map:${mapname}:stats:completions`, TTL, JSON.stringify(completionsOverTime)),
      client.setEx(`surfstats:map:${mapname}:stats:time-on-map`, TTL, JSON.stringify(timeOnMapData)),
      client.setEx(`surfstats:map:${mapname}:stats:checkpoints`, TTL, JSON.stringify(checkpointStats)),
      client.setEx(`surfstats:map:${mapname}:stats:wr-checkpoint:${maxCheckpoint}`, TTL, JSON.stringify(wrCheckpointTimes ?? [])),
      client.setEx(`surfstats:map:${mapname}:stats:finish-time`, TTL, JSON.stringify(finishTimeData)),
      client.setEx(`surfstats:map:${mapname}:stats:bonus-time`, TTL, JSON.stringify(bonusCompletionsOverTime)),
      client.setEx(`surfstats:map:${mapname}:stats:percentiles`, TTL, JSON.stringify(percentileTimes)),
    ]);

    logger.debug(`[MapGraphPrecache] Cached graphs for ${mapname}`);
  } catch (error) {
    logger.warn(`[MapGraphPrecache] Failed to cache graphs for ${mapname}: ${getErrorMessage(error)}`);
  }
}

/**
 * Start background refresh for a single map with jitter.
 * Called after initial precache and periodically thereafter.
 */
function startMapRefresh(mapname: string): void {
  // Clear existing timer if any
  const existing = refreshTimers.get(mapname);
  if (existing) {
    clearTimeout(existing);
  }

  // Random jitter: 11.5 to 12.5 hours
  const jitter = (Math.random() * 2 - 1) * REFRESH_JITTER_MS;
  const interval = REFRESH_INTERVAL_MS + jitter;

  const timer = setTimeout(async () => {
    await precacheMapGraphs(mapname);
    startMapRefresh(mapname); // Reschedule
  }, interval);

  refreshTimers.set(mapname, timer);
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
 * Start the map graph precache at application startup.
 * - Fetches all map names from cache
 * - Processes them in rate-limited batches
 * - Starts background refresh timers for each map
 * - Non-blocking: server is ready immediately
 */
export function startMapGraphPrecache(): void {
  if (precacheStarted) {
    logger.debug('[MapGraphPrecache] Precache already started');
    return;
  }
  precacheStarted = true;

  logger.info('[MapGraphPrecache] Starting map graph precache...');

  // Fire and forget - don't block server readiness
  (async () => { // eslint-disable-line @typescript-eslint/no-floating-promises
    try {
      const metadata = await getAllMapMetadataFromCache();
      const mapNames = Array.from(metadata.keys());
      logger.info(`[MapGraphPrecache] Found ${mapNames.length} maps to precache`);

      // Process in batches with delay between each batch
      for (let i = 0; i < mapNames.length; i += BATCH_SIZE) {
        const batch = mapNames.slice(i, i + BATCH_SIZE);
        await processBatch(batch);

        // Delay between batches (except after the last one)
        if (i + BATCH_SIZE < mapNames.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      logger.info(`[MapGraphPrecache] Precache complete for ${mapNames.length} maps`);

      // Start background refresh timers for each map
      for (const mapname of mapNames) {
        startMapRefresh(mapname);
      }

      logger.info(`[MapGraphPrecache] Background refresh started for ${mapNames.length} maps`);
    } catch (error) {
      logger.error(`[MapGraphPrecache] Failed to start precache: ${getErrorMessage(error)}`);
    }
  })();
}

// Graceful shutdown: clear all refresh timers.
onShutdown('map-graph-precache', () => {
  for (const [mapname, timer] of refreshTimers) {
    clearTimeout(timer);
    refreshTimers.delete(mapname);
  }
  logger.info('[MapGraphPrecache] All refresh timers cleared');
});
