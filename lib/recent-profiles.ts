import 'server-only';
import client from './valkey';
import logger from './logger';
import { getErrorMessage } from './errors';

// A capped sorted set: written by the profile read path, read by the warmer, which
// keeps exactly these profiles' keys fresh.
export const RECENT_PROFILES_KEY = 'surfstats:player:recent';
export const RECENT_PROFILES_MAX = 100;

/** Fire-and-forget, so it never delays a render; one transaction so the ZADD always gets its trim
 * to the newest {@link RECENT_PROFILES_MAX}. Views, not points, pick the warm set: it self-tunes,
 * and a profile no longer viewed falls off and expires. */
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
