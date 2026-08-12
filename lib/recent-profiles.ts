import 'server-only';
import client from './valkey';
import logger from './logger';
import { RECENT_PROFILES_KEY, RECENT_PROFILES_MAX } from './cache-keys';
import { getErrorMessage } from './errors';

/**
 * Record a profile view in the capped recently-viewed set.
 *
 * Fire-and-forget so it never delays a render, and both commands go in one
 * transaction: the ZADD is only ever paired with the trim that keeps the newest
 * {@link RECENT_PROFILES_MAX}. Selecting the warm set from real views (rather
 * than from a points ranking) means it self-tunes and stays bounded, and a
 * profile that stops being viewed falls off the tail and just expires.
 */
export function recordProfileView(steamid: string): void {
  void client
    .multi()
    .zAdd(RECENT_PROFILES_KEY, { score: Date.now(), value: steamid })
    .zRemRangeByRank(RECENT_PROFILES_KEY, 0, -(RECENT_PROFILES_MAX + 1))
    .exec()
    .catch((error: unknown) => {
      logger.debug(`[RecentProfiles] Failed to record view of ${steamid}: ${getErrorMessage(error)}`);
    });
}

/** SteamIDs currently in the warm set (at most {@link RECENT_PROFILES_MAX}). */
export async function listRecentProfiles(): Promise<string[]> {
  return client.zRange(RECENT_PROFILES_KEY, 0, -1);
}
