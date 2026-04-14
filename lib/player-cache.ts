import 'server-only';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { unstable_cache } from 'next/cache';
import logger from '@/lib/logger';
import { getPlayerCount } from '@/lib/registry-cache';
import { sanitizeSearchQuery } from './sanitize';

/**
 * Player rank data from database
 */
export interface PlayerRank extends RowDataPacket {
  steamid: string;
  name: string;
  country: string;
  points: number;
  finishedmaps: number;
  lastseen: string;
  rank: number;
}

/**
 * Player search result (lighter than full PlayerRank)
 */
export interface PlayerSearchResult {
  steamid: string;
  name: string;
  points: number;
}

/**
 * Player name result (minimal data for metadata)
 */
export interface PlayerNameResult {
  name: string;
}

/**
 * Result of getPlayers paginated query
 */
export interface PlayersResult {
  players: PlayerRank[];
  total: number;
  totalPages: number;
}

/**
 * Internal function to fetch paginated players list
 */
async function fetchPlayersInternal(
  page: number,
  search: string
): Promise<PlayersResult> {
  logger.debug(`[PlayerCache] Fetching players list (page: ${page}, search: "${search || 'none'}")`);
  
  try {
    const limit = 20;
    const offset = (page - 1) * limit;
    
    // Sanitize search query to prevent SQL injection via LIKE wildcards
    const sanitizedSearch = sanitizeSearchQuery(search);
    
    // Use window function for rank calculation (much more efficient than correlated subquery)
    // RANK() OVER (ORDER BY points DESC) calculates rank based on points
    // This is O(n log n) instead of O(n²) for the correlated subquery
    let query: string;
    const params: (string | number)[] = [];
    
    if (sanitizedSearch) {
      // For search, we need to use a subquery to filter first, then calculate rank
      query = `
        SELECT
          ranked.steamid, ranked.name, ranked.country, ranked.points,
          ranked.finishedmaps, ranked.lastseen, ranked.rank
        FROM (
          SELECT
            steamid, name, country, points, finishedmaps, lastseen,
            RANK() OVER (ORDER BY points DESC) as rank
          FROM ck_playerrank
          WHERE name LIKE ? OR steamid LIKE ?
        ) ranked
        ORDER BY ranked.points DESC
        LIMIT ? OFFSET ?
      `;
      params.push(`%${sanitizedSearch}%`, `%${sanitizedSearch}%`, limit, offset);
    } else {
      // For non-search, use window function directly with pagination
      query = `
        SELECT
          steamid, name, country, points, finishedmaps, lastseen,
          RANK() OVER (ORDER BY points DESC) as rank
        FROM ck_playerrank
        ORDER BY points DESC
        LIMIT ? OFFSET ?
      `;
      params.push(limit, offset);
    }
    
    const [rows] = await pool.query<PlayerRank[]>(query, params);
    
    // Get total count for pagination
    let total: number;
    if (sanitizedSearch) {
      // For search, we need to count matching records
      const countQuery = `SELECT COUNT(*) as total FROM ck_playerrank WHERE name LIKE ? OR steamid LIKE ?`;
      const countParams = [`%${sanitizedSearch}%`, `%${sanitizedSearch}%`];
      const [countRows] = await pool.query<RowDataPacket[]>(countQuery, countParams);
      total = countRows[0].total;
    } else {
      // Use cached player count for non-search queries
      total = await getPlayerCount();
    }
    
    logger.debug(`[PlayerCache] Retrieved ${rows.length} players (page ${page} of ${Math.ceil(total / limit)}, ${total} total)`);
    
    return { players: rows, total, totalPages: Math.ceil(total / limit) };
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    const errorMessage = err.message || 'Unknown error';
    logger.error(`[PlayerCache] Failed to fetch players: ${errorMessage}`);
    logger.error(`[PlayerCache] Error code: ${err.code || 'N/A'}`);
    return { players: [], total: 0, totalPages: 0 };
  }
}

/**
 * Fetch paginated players list with 1 hour cache
 */
export const getPlayers = unstable_cache(
  fetchPlayersInternal,
  ['players-list'],
  { revalidate: 3600 } // Cache for 1 hour
);

/**
 * Internal function to search players (for search page)
 */
async function searchPlayersInternal(query: string): Promise<PlayerSearchResult[]> {
  // Sanitize search query to prevent SQL injection via LIKE wildcards
  const sanitizedQuery = sanitizeSearchQuery(query);
  
  logger.debug(`[PlayerCache] Searching players for: "${sanitizedQuery}"`);
  
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT steamid, name, points
      FROM ck_playerrank
      WHERE name LIKE ? OR steamid LIKE ?
      ORDER BY points DESC
      LIMIT 10
    `, [`%${sanitizedQuery}%`, `%${sanitizedQuery}%`]);
    
    return rows.map(row => ({
      steamid: row.steamid,
      name: row.name,
      points: row.points
    }));
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    const errorMessage = err.message || 'Unknown error';
    logger.error(`[PlayerCache] Failed to search players: ${errorMessage}`);
    logger.error(`[PlayerCache] Error code: ${err.code || 'N/A'}`);
    return [];
  }
}

/**
 * Search players with 1 hour cache
 * Used by the search page to find players matching a query
 */
export const searchPlayers = unstable_cache(
  searchPlayersInternal,
  ['players-search'],
  { revalidate: 3600 } // Cache for 1 hour
);

/**
 * Internal function to fetch player name
 */
async function getPlayerNameInternal(steamid: string): Promise<PlayerNameResult> {
  logger.debug(`[PlayerCache] Fetching player name for: ${steamid}`);
  
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT name FROM ck_playerrank WHERE steamid = ?',
      [steamid]
    );
    
    if (rows.length === 0) {
      logger.warn(`[PlayerCache] No player found with SteamID: ${steamid}`);
      return { name: '' };
    }
    
    return { name: rows[0].name };
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    const errorMessage = err.message || 'Unknown error';
    logger.error(`[PlayerCache] Failed to fetch player name for ${steamid}: ${errorMessage}`);
    logger.error(`[PlayerCache] Error code: ${err.code || 'N/A'}`);
    return { name: '' };
  }
}

/**
 * Get player name with 24 hour cache
 * Used by generateMetadata and getPlayerData to avoid duplicate queries
 */
export const getPlayerName = unstable_cache(
  getPlayerNameInternal,
  ['player-name'],
  { revalidate: 86400 } // Cache for 24 hours
);
