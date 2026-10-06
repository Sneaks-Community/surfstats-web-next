import 'server-only';
import { cachedFetch } from './cached-fetch';
import { validateMapName } from './validators';
import { mapKey } from './cache-keys';
import logger from './logger';
import { getErrorMessage } from './errors';

export interface MapCachedFetchOptions<T> {
  /** Raw, unvalidated. */
  mapname: string;
  /** Appended to `surfstats:map:<map>:`; chart series use `MAP_STATS_SUFFIXES`. */
  keySuffix: string;
  /** Seconds. */
  ttl: number;
  /** Returned uncached when the map name is invalid or the fetch throws. */
  empty: T;
  /** Loader run on a cache miss. */
  fetch: (validMapname: string) => Promise<T>;
  /** Names the operation in the error log, e.g. "leaderboard records". */
  errorLabel: string;
  /** Run the loader under the expensive-query semaphore. Default false. */
  expensive?: boolean;
  /**
   * Refresh in place: skip the read, overwrite on success. On-demand reads leave it undefined,
   * which `cachedFetch` treats differently from a refresher's explicit `false`.
   */
  force?: boolean;
  /** For fetch errors. Default 'error'. */
  errorLevel?: 'warn' | 'error';
}

/**
 * Per-map {@link cachedFetch}: validates the name, builds the key, locks, logs failures.
 * An invalid name logs a warning and resolves to `empty` without touching the cache.
 */
export function mapCachedFetch<T>({
  mapname,
  keySuffix,
  ttl,
  empty,
  fetch,
  errorLabel,
  expensive = false,
  force,
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
    force,
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
