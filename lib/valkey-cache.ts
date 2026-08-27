import 'server-only';
import client from './valkey';
import logger from './logger';
import { getErrorMessage } from './errors';

// A failing-but-connected cache sends every request to the DB uncached, so it
// must be logged, but per-call would be one line per query.
const FAILURE_LOG_WINDOW_MS = 60_000;
const failures = new Map<string, { nextLogAt: number; suppressed: number }>();

/** Valkey replies lead with a code (OOM, READONLY); client errors only have a class name. */
function failureKind(error: unknown): string {
  const message = getErrorMessage(error);
  return message.match(/^[A-Z]{3,}\b/)?.[0] ?? (error as { name?: string }).name ?? 'Unknown';
}

function logCacheFailure(op: string, error: unknown): void {
  const kind = failureKind(error);
  const now = Date.now();
  const state = failures.get(kind) ?? { nextLogAt: 0, suppressed: 0 };

  if (now < state.nextLogAt) {
    state.suppressed++;
    failures.set(kind, state);
    return;
  }

  const also = state.suppressed
    ? ` (+${state.suppressed} more in the last ${FAILURE_LOG_WINDOW_MS / 1000}s)`
    : '';
  failures.set(kind, { nextLogAt: now + FAILURE_LOG_WINDOW_MS, suppressed: 0 });
  logger.warn(`[Cache] ${op} failed: ${getErrorMessage(error)}${also}`);
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const cached = await client.get(key);

    if (!cached) {
      logger.debug(`[Cache] Miss: ${key}`);
      return null;
    }
    const value = JSON.parse(cached) as T;
    logger.debug(`[Cache] Hit: ${key}`);
    return value;
  } catch (error) {
    logCacheFailure('GET', error);
    return null;
  }
}

/**
 * Get a value plus its remaining TTL, for {@link cachedFetch}'s early refresh.
 * `ttlMs` follows PTTL: `-2` = missing, `-1` = no expiry.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T is the caller-supplied cached value shape, mirroring cacheGet<T>
export async function cacheGetWithTtl<T>(
  key: string
): Promise<{ value: T | null; ttlMs: number }> {
  try {
    const results = await client.multi().get(key).pTTL(key).exec();
    const cached = results[0] as unknown as string | null;
    const ttlMs = Number(results[1]);

    if (!cached) {
      logger.debug(`[Cache] Miss: ${key}`);
      return { value: null, ttlMs: -2 };
    }
    logger.debug(`[Cache] Hit: ${key}`);
    return { value: JSON.parse(cached) as T, ttlMs };
  } catch (error) {
    logCacheFailure('GET+PTTL', error);
    return { value: null, ttlMs: -2 };
  }
}

/**
 * Get many values in one round trip, in key order. Missing and unparseable
 * entries come back as `null`, so callers treat them as misses.
 */
export async function cacheGetMany<T>(keys: string[]): Promise<Array<T | null>> {
  if (keys.length === 0) return [];

  try {
    const cached = await client.mGet(keys);
    return cached.map((value) => {
      if (!value) return null;
      try {
        return JSON.parse(value) as T;
      } catch {
        return null;
      }
    });
  } catch (error) {
    logCacheFailure('MGET', error);
    return keys.map(() => null);
  }
}

/** Set many values in one round trip, all with the same TTL. */
export async function cacheSetMany(
  entries: ReadonlyArray<{ key: string; value: unknown }>,
  ttl: number
): Promise<void> {
  if (entries.length === 0) return;

  try {
    const multi = client.multi();
    for (const { key, value } of entries) {
      multi.setEx(key, ttl, JSON.stringify(value));
    }
    await multi.exec();
    logger.debug(`[Cache] SET ${entries.length} keys with TTL ${ttl}s`);
  } catch (error) {
    logCacheFailure('MSETEX', error);
  }
}

export async function cacheSet(key: string, value: unknown, ttl: number): Promise<void> {
  try {
    const serialized = JSON.stringify(value);
    await client.setEx(key, ttl, serialized);
    logger.debug(`[Cache] SET ${key} with TTL ${ttl}s`);
  } catch (error) {
    logCacheFailure('SETEX', error);
  }
}

