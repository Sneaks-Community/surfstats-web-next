import 'server-only';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import { unstable_cache } from 'next/cache';
import logger from '@/lib/logger';
import { getCountryNamesFromCode, countryNameToCode, getCountryCodeFromName } from '@/lib/countries';

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
 * Get all unique country names from the database
 * Used to build a mapping of actual country values in the data
 * Cached for 24 hours - country data changes very infrequently
 */
const getDistinctCountriesInternal = async (): Promise<string[]> => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT DISTINCT country FROM ck_playerrank WHERE country IS NOT NULL AND country != ""'
    );
    return rows.map(r => r.country);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[CountryAnalytics] Failed to get distinct countries: ${errorMessage}`);
    return [];
  }
};

export const getDistinctCountries = unstable_cache(
  getDistinctCountriesInternal,
  ['distinct-countries'],
  { revalidate: 86400 } // Cache for 24 hours
);

/**
 * Get countries ranking with aggregation
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
export async function getCountriesRanking(
  sort: CountrySortKey = 'points',
  order: SortOrder = 'desc',
  page: number = 1,
  limit: number = 50
): Promise<{ countries: CountryRank[]; total: number; totalPages: number }> {
  logger.debug(`[CountryAnalytics] Fetching countries ranking (sort: ${sort}, order: ${order}, page: ${page})`);
  
  try {
    const offset = (page - 1) * limit;
    
    // First, get all country data and aggregate in JavaScript
    // This ensures proper normalization of country names before grouping
    const query = `
      SELECT country, points
      FROM ck_playerrank
      WHERE country IS NOT NULL AND country != ''
    `;
    
    const [rows] = await pool.query<RowDataPacket[]>(query);
    
    // Aggregate by normalized country code
    const countryData = new Map<string, { total_points: number; player_count: number; original_names: Set<string> }>();
    
    for (const row of rows) {
      const countryCode = getCountryCodeFromName(row.country);
      const existing = countryData.get(countryCode);
      if (existing) {
        existing.total_points += row.points;
        existing.player_count += 1;
        existing.original_names.add(row.country);
      } else {
        countryData.set(countryCode, {
          total_points: row.points,
          player_count: 1,
          original_names: new Set([row.country]),
        });
      }
    }
    
    // Convert to array and filter out:
    // - Countries with 0 points
    // - Unknown country code "UN"
    const countriesArray: CountryRank[] = [];
    for (const [code, data] of countryData) {
      // Skip countries with 0 points
      if (data.total_points <= 0) continue;
      // Skip unknown country code "UN"
      if (code === 'UN') continue;
      
      countriesArray.push({
        country: code, // Use ISO code as the country identifier
        country_code: code,
        total_points: data.total_points,
        player_count: data.player_count,
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
        comparison = (a as any)[sortColumn] - (b as any)[sortColumn];
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[CountryAnalytics] Failed to fetch countries ranking: ${errorMessage}`);
    return { countries: [], total: 0, totalPages: 0 };
  }
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
  page: number = 1,
  limit: number = 20,
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
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
  const direction = order.toUpperCase();
  
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
 * Get country statistics summary
 * Used for displaying total countries count
 */
export async function getCountriesStats(): Promise<{ totalCountries: number; totalPlayers: number }> {
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[CountryAnalytics] Failed to fetch countries stats: ${errorMessage}`);
    return { totalCountries: 0, totalPlayers: 0 };
  }
}

/**
 * Helper: Build ORDER BY clause for country rankings
 */
function getOrderByClause(sort: CountrySortKey, order: SortOrder): string {
  const columnMap: Record<CountrySortKey, string> = {
    rank: 'rank',
    country: 'country',
    points: 'total_points',
    players: 'player_count',
  };
  
  const column = columnMap[sort];
  const direction = order.toUpperCase();
  
  // For rank, we need to order by the window function result
  // For other columns, we can use the alias
  if (sort === 'rank') {
    return `rank ${direction}`;
  }
  
  return `${column} ${direction}`;
}