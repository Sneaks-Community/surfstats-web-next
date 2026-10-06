import 'server-only';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import logger from '@/lib/logger';
import { getCountryNamesFromCode, getCountryCodeFromName, getPrimaryCountryName, UNKNOWN_COUNTRY_CODE } from '@/lib/countries';
import { cachedFetch, type RefreshOptions } from './cached-fetch';
import { getErrorCode, getErrorMessage } from './errors';
import { ITEMS_PER_PAGE, sortRecords, type SortDirection } from './utils';

export interface CountryRankRow extends RowDataPacket {
  country: string;
  total_points: number;
  player_count: number;
  rank: number;
}

export interface CountryRank {
  country: string;
  country_code: string;
  total_points: number;
  player_count: number;
  rank: number;
}

export interface CountryPlayer extends RowDataPacket {
  steamid: string;
  name: string;
  country: string;
  points: number;
  finishedmaps: number;
  lastseen: string;
  rank: number;
}

export type CountrySortKey = 'rank' | 'country' | 'points' | 'players';

/**
 * Every country, merged by ISO code (DB names vary in case and spelling) and ranked by points.
 * Unsorted and unpaged, so one cache key serves every view (see {@link sortCountries}).
 */
const getCountriesRankingInternal = async (): Promise<CountryRank[]> => {
  logger.debug('[CountryCache] Fetching countries ranking');

  // Throws on failure; the fallback lives in the caller's `onError`, uncached.
  // Aggregate in SQL rather than loading every player row into memory.
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

    // Skip unresolved names. `points > 0` above makes player_count match the country page total.
    if (countryCode === UNKNOWN_COUNTRY_CODE) continue;

    const existing = byCode.get(countryCode);
    if (existing) {
      existing.total_points += Number(row.total_points);
      existing.player_count += Number(row.player_count);
    } else {
      byCode.set(countryCode, {
        country: countryCode, // the ISO code, not the DB name
        country_code: countryCode,
        total_points: Number(row.total_points),
        player_count: Number(row.player_count),
        rank: 0, // assigned after sorting
      });
    }
  }
  const countriesArray: CountryRank[] = [...byCode.values()];

  countriesArray.sort((a, b) => b.total_points - a.total_points);

  let currentRank = 1;
  for (let i = 0; i < countriesArray.length; i++) {
    if (i > 0 && countriesArray[i].total_points < countriesArray[i - 1].total_points) {
      currentRank = i + 1;
    }
    countriesArray[i].rank = currentRank;
  }

  logger.debug(`[CountryCache] Retrieved ${countriesArray.length} countries`);

  return countriesArray;
};

/**
 * Pure sort over the one cached ranking, so no sort/order needs its own key or aggregation.
 * Returns a new array (input untouched); `rank` keeps its points-based value.
 */
export function sortCountries(
  countries: readonly CountryRank[],
  sort: CountrySortKey,
  order: SortDirection
): CountryRank[] {
  // Sort on what CountryBadge renders, not the ISO code behind it: by code,
  // Sweden (SE) precedes Slovakia (SK), which reads as broken in the list.
  const displayName = (c: CountryRank): string =>
    getPrimaryCountryName(c.country_code) ?? c.country_code;

  const comparator = (a: CountryRank, b: CountryRank): number => {
    switch (sort) {
      case 'country':
        return displayName(a).localeCompare(displayName(b), 'en');
      case 'players':
        return a.player_count - b.player_count;
      case 'rank':
        return a.rank - b.rank;
      default:
        return a.total_points - b.total_points;
    }
  };

  return sortRecords(countries, order, comparator);
}

// Bump on any change to the cached result's shape or computation, so stale payloads are orphaned.
const COUNTRIES_RANKING_SCHEMA_VERSION = 5;
const COUNTRIES_RANKING_KEY = `surfstats:countries:ranking:v${COUNTRIES_RANKING_SCHEMA_VERSION}`;
const COUNTRIES_RANKING_TTL = 86400; // 24 hours

/**
 * One key for every caller: sorts and deep pages are done on the array (see {@link sortCountries})
 * and cost no DB work. `lock: true` keeps a cold start from stampeding the aggregation.
 */
export async function getCountriesRankingFromCache(
  { force }: RefreshOptions = {}
): Promise<CountryRank[]> {
  return cachedFetch(COUNTRIES_RANKING_KEY, COUNTRIES_RANKING_TTL, getCountriesRankingInternal, {
    lock: true,
    expensive: true,
    force,
    onError: (error) => {
      logger.error(`[CountryCache] Failed to fetch countries ranking: ${getErrorMessage(error)} (code: ${getErrorCode(error)})`);
      return [];
    },
  });
}

export type PlayerSortKey = 'rank' | 'player' | 'points' | 'maps' | 'lastseen';

/**
 * One country's ranked players. `points > 0` matches the players list, so the page total, page
 * ceiling and ranking `player_count` agree. Without the parens, AND binds to the first name only.
 */
function countryWhereClause(countryNames: string[]): string {
  return `points > 0 AND (${countryNames.map(() => 'country = ?').join(' OR ')})`;
}

/** One sorted page of a country's players, matching every DB spelling of the code. */
const getCountryPlayersInternal = async (
  countryCode: string,
  page = 1,
  limit = ITEMS_PER_PAGE,
  sort: PlayerSortKey = 'rank',
  order: SortDirection = 'desc'
): Promise<{ players: CountryPlayer[]; total: number; totalPages: number; countryName: string }> => {
  logger.debug(`[CountryCache] Fetching players for country: ${countryCode} (page: ${page}, sort: ${sort}, order: ${order})`);

  // Throws on failure; the fallback lives in the caller's `onError`, uncached.
  const countryNames = getCountryNamesFromCode(countryCode);

  // An unresolvable country code is a real (cacheable) result, not a failure.
  if (countryNames.length === 0) {
    logger.warn(`[CountryCache] Invalid country code: ${countryCode}`);
    return { players: [], total: 0, totalPages: 0, countryName: countryCode };
  }

  const offset = (page - 1) * limit;

  const whereClause = countryWhereClause(countryNames);

  const orderByClause = getPlayerOrderByClause(sort, order);

  // The window runs after the WHERE, so rank is within the country ("Country Rank" in the UI).
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

  const countQuery = `
    SELECT COUNT(*) as total
    FROM ck_playerrank
    WHERE ${whereClause}
  `;
  const countParams = countryNames;
  const [countRows] = await pool.query<RowDataPacket[]>(countQuery, countParams);
  const total = countRows[0]?.total || 0;

  // The first variation is the most common spelling.
  const countryName = countryNames[0];

  logger.debug(`[CountryCache] Retrieved ${rows.length} players for ${countryName} (page ${page} of ${Math.ceil(total / limit)})`);

  return {
    players: rows,
    total,
    totalPages: Math.ceil(total / limit),
    countryName,
  };
};

// Bump the version whenever countryWhereClause changes which players match.
const COUNTRIES_PLAYERS_KEY = 'surfstats:countries:players:v4';
const COUNTRIES_PLAYERS_TTL = 86400; // 24 hours, matches the country ranking (same slow-moving table)

/** Cached per country/page/sort/order; the heavy RANK() query runs under the semaphore and lock. */
export async function getCountryPlayers(
  countryCode: string,
  page = 1,
  limit = ITEMS_PER_PAGE,
  sort: PlayerSortKey = 'rank',
  order: SortDirection = 'desc'
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
        logger.error(`[CountryCache] Failed to fetch players for country ${countryCode}: ${getErrorMessage(error)} (code: ${getErrorCode(error)})`);
        return { players: [], total: 0, totalPages: 0, countryName: countryCode };
      },
    }
  );
}

// Versioned in step with COUNTRIES_PLAYERS_KEY (same filter).
const COUNTRY_PLAYER_COUNT_KEY = 'surfstats:countries:playercount:v4';
const COUNTRY_PLAYER_COUNT_TTL = 86400; // 24 hours, matches the sibling country caches

/**
 * Lets the country page clamp `?page=` before the RANK() query; 0 for an unresolvable code.
 * Must share {@link countryWhereClause} with the page query, or real pages become unreachable.
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
        logger.error(`[CountryCache] Failed to count players for country ${countryCode}: ${getErrorMessage(error)} (code: ${getErrorCode(error)})`);
        return 0;
      },
    }
  );
}

function getPlayerOrderByClause(sort: PlayerSortKey, order: SortDirection): string {
  const columnMap: Record<PlayerSortKey, string> = {
    rank: '`rank`',
    player: 'name',
    points: 'points',
    maps: 'finishedmaps',
    lastseen: 'lastseen',
  };
  
  const column = columnMap[sort];
  const direction = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  // Name sorts by its own (case-insensitive) collation: `COLLATE utf8mb4_*` would error on the
  // latin1 `name` column some ckSurf schemas use.

  // Never-seen players (NULL) sort last.
  if (sort === 'lastseen') {
    if (order === 'desc') {
      return `${column} IS NULL, ${column} ${direction}`;
    } else {
      return `${column} IS NOT NULL, ${column} ${direction}`;
    }
  }
  
  return `${column} ${direction}`;
}
