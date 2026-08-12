import 'server-only';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import logger from '@/lib/logger';
import { getCountryNamesFromCode, getCountryCodeFromName, UNKNOWN_COUNTRY_CODE } from '@/lib/countries';
import { cachedFetch } from './cached-fetch';
import { PLAYERS_PAGE_SIZE } from './player-cache';
import { getErrorCode, getErrorMessage } from './errors';

/**
 * Country ranking data from database (raw query result)
 */
export interface CountryRankRow extends RowDataPacket {
  country: string;
  total_points: number;
  player_count: number;
  rank: number;
}

/**
 * Processed country ranking data with ISO code
 */
export interface CountryRank {
  country: string;
  country_code: string;
  total_points: number;
  player_count: number;
  rank: number;
}

/**
 * Player data within a country
 */
export interface CountryPlayer extends RowDataPacket {
  steamid: string;
  name: string;
  country: string;
  points: number;
  finishedmaps: number;
  lastseen: string;
  rank: number;
}

/**
 * Sort configuration for country rankings
 */
export type CountrySortKey = 'rank' | 'country' | 'points' | 'players';
export type SortOrder = 'asc' | 'desc';

/**
 * Internal function for getting countries ranking with aggregation
 *
 * Query optimization notes:
 * - Fetches all country data and aggregates in JavaScript for proper normalization
 * - Country names are normalized to ISO codes BEFORE grouping to avoid duplicates
 * - Supports sorting by rank, country name, points, or player count
 * - Pagination applied after sorting
 *
 * IMPORTANT: Country names in the database may have variations (e.g., "Thailand", "thailand", "THAILAND").
 * We normalize them to ISO codes BEFORE grouping to avoid duplicate entries.
 */
const getCountriesRankingInternal = async (
  sort: CountrySortKey = 'points',
  order: SortOrder = 'desc',
  page = 1,
  limit = 50
): Promise<{ countries: CountryRank[]; total: number; totalPages: number }> => {
  logger.debug(`[CountryAnalytics] Fetching countries ranking (sort: ${sort}, order: ${order}, page: ${page})`);

  // Throws on failure; the fallback lives in the caller's `onError`, uncached.
  const offset = (page - 1) * limit;

  // Use SQL GROUP BY for efficient aggregation instead of loading all rows into memory
  // This is O(n) on the database side instead of O(n) in JavaScript with n = total players
  const query = `
    SELECT
      country,
      SUM(points) as total_points,
      COUNT(*) as player_count
    FROM ck_playerrank
    WHERE points > 0 AND country IS NOT NULL AND country != ''
    GROUP BY country
    ORDER BY total_points DESC
  `;

  const [rows] = await pool.query<RowDataPacket[]>(query);

  // Merge rows that resolve to the same ISO code (e.g. England/Scotland -> GB),
  // otherwise each variant is a duplicate row that skews counts and React keys.
  const byCode = new Map<string, CountryRank>();
  for (const row of rows) {
    const countryCode = getCountryCodeFromName(row.country);

    // Skip unresolved country codes. `points > 0` in the query already means
    // total_points is positive and player_count counts only ranked players,
    // matching the per-country page's total.
    if (countryCode === UNKNOWN_COUNTRY_CODE) continue;

    const existing = byCode.get(countryCode);
    if (existing) {
      existing.total_points += Number(row.total_points);
      existing.player_count += Number(row.player_count);
    } else {
      byCode.set(countryCode, {
        country: countryCode, // Use ISO code as the country identifier
        country_code: countryCode,
        total_points: Number(row.total_points),
        player_count: Number(row.player_count),
        rank: 0, // Will be calculated after sorting
      });
    }
  }
  const countriesArray: CountryRank[] = [...byCode.values()];

  // Sort by points descending to calculate ranks
  countriesArray.sort((a, b) => b.total_points - a.total_points);

  // Assign ranks
  let currentRank = 1;
  for (let i = 0; i < countriesArray.length; i++) {
    if (i > 0 && countriesArray[i].total_points < countriesArray[i - 1].total_points) {
      currentRank = i + 1;
    }
    countriesArray[i].rank = currentRank;
  }

  // Apply user-requested sort
  const sortColumn = sort === 'rank' ? 'rank' :
                      sort === 'country' ? 'country' :
                      sort === 'points' ? 'total_points' : 'player_count';

  countriesArray.sort((a, b) => {
    let comparison: number;
    if (sortColumn === 'country') {
      comparison = a.country.localeCompare(b.country);
    } else if (sortColumn === 'player_count') {
      comparison = a.player_count - b.player_count;
    } else if (sortColumn === 'rank') {
      comparison = a.rank - b.rank;
    } else {
      comparison = a.total_points - b.total_points;
    }
    return order === 'asc' ? comparison : -comparison;
  });

  // Get total count
  const total = countriesArray.length;

  // Apply pagination
  const paginatedCountries = countriesArray.slice(offset, offset + limit);

  logger.debug(`[CountryAnalytics] Retrieved ${paginatedCountries.length} countries (page ${page} of ${Math.ceil(total / limit)})`);

  return {
    countries: paginatedCountries,
    total,
    totalPages: Math.ceil(total / limit),
  };
};

/**
 * Get countries ranking with aggregation
 *
 * Query optimization notes:
 * - Uses SQL GROUP BY for efficient aggregation on the database side
 * - Country names are normalized to ISO codes in application code after aggregation
 * - Supports sorting by rank, country name, points, or player count
 * - Pagination applied after sorting
 *
 * IMPORTANT: Country names in the database may have variations (e.g., "Thailand", "thailand", "THAILAND").
 * We normalize them to ISO codes in application code to avoid duplicate entries.
 * Cached for 24 hours - country rankings change relatively infrequently
 */
// Bump on any change to the cached result's shape or computation; orphans stale
// payloads instead of serving them until the 24h TTL expires.
// v3: country-name normalization now resolves the GeoIP "The <country>" forms
// (e.g. "The United States"), so the aggregation includes countries that v2
// silently dropped — the old payload must not be served.
// v4: `player_count` now counts only players with points > 0, matching the
// per-country page's total and the players list.
const COUNTRIES_RANKING_SCHEMA_VERSION = 4;
const COUNTRIES_RANKING_KEY = `surfstats:countries:ranking:v${COUNTRIES_RANKING_SCHEMA_VERSION}`;
const COUNTRIES_RANKING_TTL = 86400; // 24 hours

/**
 * Get countries ranking from Valkey cache
 */
export async function getCountriesRankingFromCache(
  sort: CountrySortKey = 'points',
  order: SortOrder = 'desc',
  page = 1,
  limit = 50
): Promise<{ countries: CountryRank[]; total: number; totalPages: number }> {
  const cacheKey = `${COUNTRIES_RANKING_KEY}:${sort}:${order}:${page}:${limit}`;

  return cachedFetch(cacheKey, COUNTRIES_RANKING_TTL, () =>
    getCountriesRankingInternal(sort, order, page, limit),
    {
      expensive: true,
      onError: (error) => {
        logger.error(`[CountryAnalytics] Failed to fetch countries ranking: ${getErrorMessage(error)} (code: ${getErrorCode(error)})`);
        return { countries: [], total: 0, totalPages: 0 };
      },
    }
  );
}

/**
 * Sort keys for country players
 */
export type PlayerSortKey = 'rank' | 'player' | 'points' | 'maps' | 'lastseen';

/**
 * `WHERE` fragment selecting one country's ranked players.
 *
 * Carries the same `points > 0` filter `fetchPlayersInternal` applies, so the
 * country page's total, its page ceiling, and the countries list's
 * `player_count` all count the same rows. The name variations are OR'd and
 * parenthesised; without the parens the `AND` would bind to the first one only.
 */
function countryWhereClause(countryNames: string[]): string {
  return `points > 0 AND (${countryNames.map(() => 'country = ?').join(' OR ')})`;
}

/**
 * Internal function for getting players from a specific country
 *
 * Query optimization notes:
 * - Uses RANK() window function for player ranking within the country
 * - Uses index on country column (if available) for filtering
 * - Pagination with LIMIT/OFFSET
 * - Handles multiple country name variations for the same ISO code
 * - Supports sorting by different columns
 */
const getCountryPlayersInternal = async (
  countryCode: string,
  page = 1,
  limit = PLAYERS_PAGE_SIZE,
  sort: PlayerSortKey = 'rank',
  order: SortOrder = 'desc'
): Promise<{ players: CountryPlayer[]; total: number; totalPages: number; countryName: string }> => {
  logger.debug(`[CountryAnalytics] Fetching players for country: ${countryCode} (page: ${page}, sort: ${sort}, order: ${order})`);

  // Throws on failure; the fallback lives in the caller's `onError`, uncached.
  // Get all possible country name variations for this code
  const countryNames = getCountryNamesFromCode(countryCode);

  // An unresolvable country code is a real (cacheable) result, not a failure.
  if (countryNames.length === 0) {
    logger.warn(`[CountryAnalytics] Invalid country code: ${countryCode}`);
    return { players: [], total: 0, totalPages: 0, countryName: countryCode };
  }

  const offset = (page - 1) * limit;

  const whereClause = countryWhereClause(countryNames);

  // Build ORDER BY clause based on sort column
  const orderByClause = getPlayerOrderByClause(sort, order);

  // Rank is deliberately *within the country*: the window runs after the WHERE,
  // so the numbering is 1..N over this country's players, not the global list.
  // The column is labelled "Country Rank" in the UI to keep that explicit.
  const playersQuery = `
    SELECT
      steamid, name, country, points, finishedmaps, lastseen,
      RANK() OVER (ORDER BY points DESC) as \`rank\`
    FROM ck_playerrank
    WHERE ${whereClause}
    ORDER BY ${orderByClause}
    LIMIT ? OFFSET ?
  `;

  const params = [...countryNames, limit, offset];
  const [rows] = await pool.query<CountryPlayer[]>(playersQuery, params);

  // Get total count for this country
  const countQuery = `
    SELECT COUNT(*) as total
    FROM ck_playerrank
    WHERE ${whereClause}
  `;
  const countParams = countryNames;
  const [countRows] = await pool.query<RowDataPacket[]>(countQuery, countParams);
  const total = countRows[0]?.total || 0;

  // Use the first country name as the display name (most common variation)
  const countryName = countryNames[0];

  logger.debug(`[CountryAnalytics] Retrieved ${rows.length} players for ${countryName} (page ${page} of ${Math.ceil(total / limit)})`);

  return {
    players: rows,
    total,
    totalPages: Math.ceil(total / limit),
    countryName,
  };
};

// v3: matches the country-name normalization fix (see ranking key) — the WHERE
// clause now includes "The <country>" spellings, changing which players a
// country page returns.
// v4: rows and `total` are filtered to points > 0 (see countryWhereClause).
const COUNTRIES_PLAYERS_KEY = 'surfstats:countries:players:v4';
const COUNTRIES_PLAYERS_TTL = 86400; // 24 hours — matches country ranking/stats

/**
 * Get players from a specific country from Valkey cache.
 *
 * Wraps {@link getCountryPlayersInternal} in the shared cache-aside layer, keyed
 * on every parameter so each country/page/sort/order combination caches
 * independently. The RANK() window query is heavy, so it runs under the
 * expensive-query semaphore + single-flight lock. Cached for 24 hours to match
 * the sibling country ranking/stats caches (same slow-moving `ck_playerrank`).
 */
export async function getCountryPlayers(
  countryCode: string,
  page = 1,
  limit = PLAYERS_PAGE_SIZE,
  sort: PlayerSortKey = 'rank',
  order: SortOrder = 'desc'
): Promise<{ players: CountryPlayer[]; total: number; totalPages: number; countryName: string }> {
  const cacheKey = `${COUNTRIES_PLAYERS_KEY}:${countryCode}:${sort}:${order}:${page}:${limit}`;

  return cachedFetch(
    cacheKey,
    COUNTRIES_PLAYERS_TTL,
    () => getCountryPlayersInternal(countryCode, page, limit, sort, order),
    {
      lock: true,
      expensive: true,
      onError: (error) => {
        logger.error(`[CountryAnalytics] Failed to fetch players for country ${countryCode}: ${getErrorMessage(error)} (code: ${getErrorCode(error)})`);
        return { players: [], total: 0, totalPages: 0, countryName: countryCode };
      },
    }
  );
}

// v4: filtered to points > 0, in step with COUNTRIES_PLAYERS_KEY.
const COUNTRY_PLAYER_COUNT_KEY = 'surfstats:countries:playercount:v4';
const COUNTRY_PLAYER_COUNT_TTL = 86400; // 24 hours — matches the sibling country caches

/**
 * Total players in one country, so the country page can clamp `?page=` before
 * the paginated RANK() query runs.
 *
 * Shares {@link countryWhereClause} with {@link getCountryPlayersInternal}; the
 * two must stay on the same filter or the ceiling and `totalPages` disagree and
 * real pages become unreachable.
 *
 * @param countryCode - ISO 3166-1 alpha-2 code
 * @returns Player count, or 0 for an unresolvable code
 */
export async function getCountryPlayerCount(countryCode: string): Promise<number> {
  const cacheKey = `${COUNTRY_PLAYER_COUNT_KEY}:${countryCode}`;

  return cachedFetch(
    cacheKey,
    COUNTRY_PLAYER_COUNT_TTL,
    async () => {
      const countryNames = getCountryNamesFromCode(countryCode);
      if (countryNames.length === 0) return 0;

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as total FROM ck_playerrank WHERE ${countryWhereClause(countryNames)}`,
        countryNames
      );
      return Number(rows[0]?.total) || 0;
    },
    {
      lock: true,
      onError: (error) => {
        logger.error(`[CountryAnalytics] Failed to count players for country ${countryCode}: ${getErrorMessage(error)} (code: ${getErrorCode(error)})`);
        return 0;
      },
    }
  );
}

/**
 * Helper: Build ORDER BY clause for player listings
 */
function getPlayerOrderByClause(sort: PlayerSortKey, order: SortOrder): string {
  const columnMap: Record<PlayerSortKey, string> = {
    rank: '`rank`',
    player: 'name',
    points: 'points',
    maps: 'finishedmaps',
    lastseen: 'lastseen',
  };
  
  const column = columnMap[sort];
  const direction = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  
  // For text columns, use COLLATE for case-insensitive sorting
  if (sort === 'player') {
    return `${column} COLLATE utf8mb4_general_ci ${direction}`;
  }
  
  // For lastseen, handle NULL values (never seen players sort last)
  if (sort === 'lastseen') {
    if (order === 'desc') {
      return `${column} IS NULL, ${column} ${direction}`;
    } else {
      return `${column} IS NOT NULL, ${column} ${direction}`;
    }
  }
  
  return `${column} ${direction}`;
}

/**
 * Internal function for getting country statistics summary
 * Used for displaying total countries count
 */
const getCountriesStatsInternal = async (): Promise<{ totalCountries: number; totalPlayers: number }> => {
  // Throws on failure; the fallback lives in the caller's `onError`, uncached.
  // Countries: distinct resolved ISO codes, matching the ranking list (raw
  // DISTINCT names over-counted). Players: COUNT(*) over every row, including
  // unresolved countries — the full player population.
  const countriesQuery = `
    SELECT country, SUM(points) as total_points
    FROM ck_playerrank
    WHERE country IS NOT NULL AND country != ''
    GROUP BY country
  `;
  const playersQuery = `SELECT COUNT(*) as total_players FROM ck_playerrank`;

  const [[countryRows], [playerRows]] = await Promise.all([
    pool.query<RowDataPacket[]>(countriesQuery),
    pool.query<RowDataPacket[]>(playersQuery),
  ]);

  const codes = new Set<string>();
  for (const row of countryRows) {
    const countryCode = getCountryCodeFromName(row.country);
    if (row.total_points <= 0 || countryCode === UNKNOWN_COUNTRY_CODE) continue;
    codes.add(countryCode);
  }

  return {
    totalCountries: codes.size,
    totalPlayers: playerRows[0]?.total_players || 0,
  };
};

// Versioned like the ranking key so logic changes orphan stale payloads.
const COUNTRIES_STATS_KEY = 'surfstats:countries:stats:v3';
const COUNTRIES_STATS_TTL = 86400; // 24 hours

/**
 * Get country statistics summary from Valkey cache
 * Used for displaying total countries count
 */
export async function getCountriesStatsFromCache(): Promise<{ totalCountries: number; totalPlayers: number }> {
  return cachedFetch(COUNTRIES_STATS_KEY, COUNTRIES_STATS_TTL, getCountriesStatsInternal, {
    expensive: true,
    onError: (error) => {
      logger.error(`[CountryAnalytics] Failed to fetch countries stats: ${getErrorMessage(error)} (code: ${getErrorCode(error)})`);
      return { totalCountries: 0, totalPlayers: 0 };
    },
  });
}
