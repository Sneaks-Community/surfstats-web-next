import 'server-only';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import logger from '@/lib/logger';
import { getCountryNamesFromCode, getCountryCodeFromName } from '@/lib/countries';
import { cacheGet, cacheSet } from './valkey-cache';
import { getErrorMessage } from './errors';

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
  
  try {
    const offset = (page - 1) * limit;
    
    // Use SQL GROUP BY for efficient aggregation instead of loading all rows into memory
    // This is O(n) on the database side instead of O(n) in JavaScript with n = total players
    const query = `
      SELECT
        country,
        SUM(points) as total_points,
        COUNT(*) as player_count
      FROM ck_playerrank
      WHERE country IS NOT NULL AND country != ''
      GROUP BY country
      ORDER BY total_points DESC
    `;
    
    const [rows] = await pool.query<RowDataPacket[]>(query);
    
    // Normalize country names to ISO codes and filter out invalid entries
    const countriesArray: CountryRank[] = [];
    for (const row of rows) {
      const countryCode = getCountryCodeFromName(row.country);
      
      // Skip countries with 0 points or unknown country code "UN"
      if (row.total_points <= 0 || countryCode === 'UN') continue;
      
      countriesArray.push({
        country: countryCode, // Use ISO code as the country identifier
        country_code: countryCode,
        total_points: Number(row.total_points),
        player_count: Number(row.player_count),
        rank: 0, // Will be calculated after sorting
      });
    }
    
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
      let comparison = 0;
      if (sortColumn === 'country') {
        comparison = a.country.localeCompare(b.country);
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
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    logger.error(`[CountryAnalytics] Failed to fetch countries ranking: ${errorMessage}`);
    return { countries: [], total: 0, totalPages: 0 };
  }
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
const COUNTRIES_RANKING_KEY = 'surfstats:countries:ranking';
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
  
  const cached = await cacheGet<{ countries: CountryRank[]; total: number; totalPages: number }>(cacheKey);

  if (cached) {
    return cached;
  }

  const result = await getCountriesRankingInternal(sort, order, page, limit);

  await cacheSet(cacheKey, result, COUNTRIES_RANKING_TTL);

  return result;
}

/**
 * Sort keys for country players
 */
export type PlayerSortKey = 'rank' | 'player' | 'points' | 'maps' | 'lastseen';

/**
 * Get players from a specific country
 *
 * Query optimization notes:
 * - Uses RANK() window function for player ranking within country
 * - Uses index on country column (if available) for filtering
 * - Pagination with LIMIT/OFFSET
 * - Handles multiple country name variations for the same ISO code
 * - Supports sorting by different columns
 */
export async function getCountryPlayers(
  countryCode: string,
  page = 1,
  limit = 20,
  sort: PlayerSortKey = 'rank',
  order: SortOrder = 'desc'
): Promise<{ players: CountryPlayer[]; total: number; totalPages: number; countryName: string }> {
  logger.debug(`[CountryAnalytics] Fetching players for country: ${countryCode} (page: ${page}, sort: ${sort}, order: ${order})`);
  
  try {
    // Get all possible country name variations for this code
    const countryNames = getCountryNamesFromCode(countryCode);
    
    if (countryNames.length === 0) {
      logger.warn(`[CountryAnalytics] Invalid country code: ${countryCode}`);
      return { players: [], total: 0, totalPages: 0, countryName: countryCode };
    }
    
    const offset = (page - 1) * limit;
    
    // Build WHERE clause for multiple country name variations
    // Using OR conditions for each variation
    const whereClause = countryNames.map(() => 'country = ?').join(' OR ');
    
    // Build ORDER BY clause based on sort column
    const orderByClause = getPlayerOrderByClause(sort, order);
    
    // Query for players with rank calculation
    // RANK() OVER (ORDER BY points DESC) calculates global rank
    const playersQuery = `
      SELECT
        steamid, name, country, points, finishedmaps, lastseen,
        RANK() OVER (ORDER BY points DESC) as rank
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
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    logger.error(`[CountryAnalytics] Failed to fetch players for country ${countryCode}: ${errorMessage}`);
    return { players: [], total: 0, totalPages: 0, countryName: countryCode };
  }
}

/**
 * Helper: Build ORDER BY clause for player listings
 */
function getPlayerOrderByClause(sort: PlayerSortKey, order: SortOrder): string {
  const columnMap: Record<PlayerSortKey, string> = {
    rank: 'rank',
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
  try {
    const query = `
      SELECT
        COUNT(DISTINCT CASE WHEN country IS NOT NULL AND country != '' THEN country END) as total_countries,
        COUNT(*) as total_players
      FROM ck_playerrank
    `;
    const [rows] = await pool.query<RowDataPacket[]>(query);
    return {
      totalCountries: rows[0]?.total_countries || 0,
      totalPlayers: rows[0]?.total_players || 0,
    };
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    logger.error(`[CountryAnalytics] Failed to fetch countries stats: ${errorMessage}`);
    return { totalCountries: 0, totalPlayers: 0 };
  }
};

const COUNTRIES_STATS_KEY = 'surfstats:countries:stats';
const COUNTRIES_STATS_TTL = 86400; // 24 hours

/**
 * Get country statistics summary from Valkey cache
 * Used for displaying total countries count
 */
export async function getCountriesStatsFromCache(): Promise<{ totalCountries: number; totalPlayers: number }> {
  const cached = await cacheGet<{ totalCountries: number; totalPlayers: number }>(COUNTRIES_STATS_KEY);

  if (cached) {
    return cached;
  }

  const stats = await getCountriesStatsInternal();

  await cacheSet(COUNTRIES_STATS_KEY, stats, COUNTRIES_STATS_TTL);

  return stats;
}
