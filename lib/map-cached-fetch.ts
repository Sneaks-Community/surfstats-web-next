import 'server-only';
import { cachedFetch } from './cached-fetch';
import { validateMapName } from './validators';
import { mapKey } from './cache-keys';
import logger from './logger';
import { getErrorMessage } from './errors';

/**
 * Options for {@link mapCachedFetch}.
 */
export interface MapCachedFetchOptions<T> {
  /** Raw (unvalidated) map name from the caller. */
  mapname: string;
  /**
   * Key part appended after the `surfstats:map:<validMapname>:` prefix. Precached
   * series must use a suffix from `MAP_STATS_SUFFIXES` (`lib/cache-keys.ts`), not a
   * literal, or the precache's `DEL` silently stops matching them.
   */
  keySuffix: string;
  /** Cache TTL in seconds. */
  ttl: number;
  /** Value returned when the map name is invalid or the fetch throws. */
  empty: T;
  /** Loader run on a cache miss; receives the validated map name. */
  fetch: (validMapname: string) => Promise<T>;
  /** Operation label for the miss-path error log (e.g. "leaderboard records"). */
  errorLabel: string;
  /** Run the loader under the expensive-query concurrency cap. Defaults to false. */
  expensive?: boolean;
  /** Log level for fetch errors. Defaults to 'error'. */
  errorLevel?: 'warn' | 'error';
}

/**
 * Shared skeleton for every per-map Valkey cache: validate the map name, build
 * the `surfstats:map:<map>:<suffix>` key, and run {@link cachedFetch} with the
 * standard lock + onError-logging wiring. Extracted from ~14 near-identical
 * copies across `valkey-map-records-cache.ts` and `valkey-map-stats-cache.ts`.
 *
 * On an invalid map name it logs a warning and resolves to `empty` without
 * touching the cache; on a fetch failure `empty` is returned (never cached).
 */
export function mapCachedFetch<T>({
  mapname,
  keySuffix,
  ttl,
  empty,
  fetch,
  errorLabel,
  expensive = false,
  errorLevel = 'error',
}: MapCachedFetchOptions<T>): Promise<T> {
  const validMapname = validateMapName(mapname);
  if (!validMapname) {
    logger.warn(`[Cache] Invalid map name: ${mapname}`);
    return Promise.resolve(empty);
  }
  const key = mapKey(validMapname, keySuffix);

  return cachedFetch<T>(key, ttl, () => fetch(validMapname), {
    lock: true,
    expensive,
    onError: (error) => {
      const message = `[Cache] Failed to fetch ${errorLabel} for ${validMapname}: ${getErrorMessage(error)}`;
      if (errorLevel === 'warn') {
        logger.warn(message);
      } else {
        logger.error(message);
      }
      return empty;
    },
  });
}
