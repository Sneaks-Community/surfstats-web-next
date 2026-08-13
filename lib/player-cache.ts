import 'server-only';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import logger from '@/lib/logger';
import { getPlayerCountFromCache } from '@/lib/registry-cache';
import type { SearchQuery } from './validators';
import { cachedFetch } from './cached-fetch';
import { cacheSet } from './valkey-cache';
import { playersListKey, PLAYERS_LIST_TTL } from './cache-keys';
import { getErrorCode, getErrorMessage } from './errors';

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

/** Rows per page in every player listing. Read path, warmer and clamping share it. */
export const PLAYERS_PAGE_SIZE = 20;

/**
 * Page-number ceiling from the cached player count. Page routes clamp `?page=`
 * against this before calling the cache functions, so an out-of-range value
 * can't mint a fresh key or a huge OFFSET.
 *
 * @param pageSize - Rows per page (defaults to {@link PLAYERS_PAGE_SIZE})
 */
export async function getPlayerPageCeiling(pageSize = PLAYERS_PAGE_SIZE): Promise<number> {
  const total = await getPlayerCountFromCache();
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Internal function to fetch paginated players list
 *
 * Throws on failure; the fallback lives in the caller's `onError`, uncached.
 */
async function fetchPlayersInternal(
  page: number,
  sanitizedSearch: SearchQuery
): Promise<PlayersResult> {
  logger.debug(`[PlayerCache] Fetching players list (page: ${page}, search: "${sanitizedSearch || 'none'}")`);

  const limit = PLAYERS_PAGE_SIZE;
  const offset = (page - 1) * limit;

  // Use window function for rank calculation (much more efficient than correlated subquery)
  // RANK() OVER (ORDER BY points DESC) calculates rank based on points
  // This is O(n log n) instead of O(n²) for the correlated subquery
  //
  // finishedmaps is read straight from the ck_playerrank column (maintained by
  // the ckSurf game server). We intentionally do NOT count ck_playertimes here:
  // aggregating that table for the map count cost ~5.5s per uncached page.
  let query: string;
  const params: Array<string | number> = [];

  if (sanitizedSearch) {
    // Rank over the whole points>0 table FIRST, then filter by name/steamid in
    // an outer WHERE. Window functions run after the inner WHERE, so filtering
    // inside the subquery would rank only the matches (giving a positional
    // 1,2,3...) instead of each player's true global rank.
    query = `
      SELECT
        ranked.steamid, ranked.name, ranked.country, ranked.points,
        ranked.finishedmaps, ranked.lastseen, ranked.\`rank\`
      FROM (
        SELECT
          steamid, name, country, points, finishedmaps, lastseen,
          RANK() OVER (ORDER BY points DESC) as \`rank\`
        FROM ck_playerrank
        WHERE points > 0
      ) ranked
      WHERE ranked.name LIKE ? OR ranked.steamid LIKE ?
      ORDER BY ranked.points DESC
      LIMIT ? OFFSET ?
    `;
    params.push(`%${sanitizedSearch}%`, `%${sanitizedSearch}%`, limit, offset);
  } else {
    // For non-search, use window function directly with pagination
    query = `
      SELECT
        ranked.steamid, ranked.name, ranked.country, ranked.points,
        ranked.finishedmaps, ranked.lastseen, ranked.\`rank\`
      FROM (
        SELECT
          steamid, name, country, points, finishedmaps, lastseen,
          RANK() OVER (ORDER BY points DESC) as \`rank\`
        FROM ck_playerrank
        WHERE points > 0
      ) ranked
      ORDER BY ranked.points DESC
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);
  }

  const [rows] = await pool.query<PlayerRank[]>(query, params);

  // Get total count for pagination
  let total: number;
  if (sanitizedSearch) {
    // For search, we need to count matching records
    const countQuery = `SELECT COUNT(*) as total FROM ck_playerrank WHERE points > 0 AND (name LIKE ? OR steamid LIKE ?)`;
    const countParams = [`%${sanitizedSearch}%`, `%${sanitizedSearch}%`];
    const [countRows] = await pool.query<RowDataPacket[]>(countQuery, countParams);
    total = countRows[0].total;
  } else {
    // Use cached player count for non-search queries
    total = await getPlayerCountFromCache();
  }

  logger.debug(`[PlayerCache] Retrieved ${rows.length} players (page ${page} of ${Math.ceil(total / limit)}, ${total} total)`);

  return { players: rows, total, totalPages: Math.ceil(total / limit) };
}

/**
 * Get paginated players list from Valkey cache
 */
export async function getPlayersFromCache(
  page: number,
  search: SearchQuery
): Promise<{
  players: PlayerRank[];
  total: number;
  totalPages: number;
}> {
  // The term is sanitized by its type; the page still needs bounding so a
  // malformed value can't spawn arbitrary distinct redis keys.
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;

  return cachedFetch(
    playersListKey(safePage, search),
    PLAYERS_LIST_TTL,
    () => fetchPlayersInternal(safePage, search),
    {
      lock: true,
      expensive: true,
      onError: (error) => {
        logger.error(`[PlayerCache] Failed to fetch players: ${getErrorMessage(error)} (code: ${getErrorCode(error)})`);
        return { players: [], total: 0, totalPages: 0 };
      },
    }
  );
}

/**
 * Proactively populate the cache for the first `pageCount` pages of the default
 * (no-search) players listing, so the pages people actually browse are always a
 * cache hit instead of triggering the full-table rank query on a miss.
 *
 * Runs one indexed `ORDER BY points DESC LIMIT k` query for the top
 * `pageCount * PAGE_SIZE` players (no `RANK()` window over the whole table) and
 * assigns rank in JS. Because the slice starts at the very top, positional rank
 * is exact RANK() (ties share a rank, gaps after) — identical to the on-demand
 * query. Called on an interval by the players-list background refresh.
 */
export async function warmPlayersListCache(pageCount: number): Promise<void> {
  const pageSize = PLAYERS_PAGE_SIZE;
  const k = Math.max(1, pageCount) * pageSize;

  const [rows] = await pool.query<PlayerRank[]>(
    `SELECT steamid, name, country, points, finishedmaps, lastseen
     FROM ck_playerrank
     WHERE points > 0
     ORDER BY points DESC
     LIMIT ?`,
    [k]
  );

  // Assign RANK() (ties share a rank; next distinct value jumps to its position).
  let rank = 0;
  let prevPoints: number | null = null;
  const ranked: PlayerRank[] = rows.map((row, i) => {
    if (row.points !== prevPoints) {
      rank = i + 1;
      prevPoints = row.points;
    }
    return { ...row, rank };
  });

  const total = await getPlayerCountFromCache();
  const totalPages = Math.ceil(total / pageSize);

  for (let page = 1; page <= pageCount; page++) {
    const players = ranked.slice((page - 1) * pageSize, page * pageSize);
    if (players.length === 0) break; // fewer players than requested pages
    // Same builder as the read path, so the empty-search key can't drift.
    await cacheSet(playersListKey(page, ''), { players, total, totalPages }, PLAYERS_LIST_TTL);
  }

  logger.debug(`[PlayerCache] Warmed ${Math.min(pageCount, Math.ceil(ranked.length / pageSize))} players-list page(s) from top ${ranked.length} players`);
}

/**
 * Internal function to search players (for search page)
 *
 * Throws on failure; the fallback lives in the caller's `onError`, uncached.
 */
async function searchPlayersInternal(sanitizedQuery: string): Promise<PlayerSearchResult[]> {
  // An empty term would issue `LIKE '%%'`, a full scan of ck_playerrank that
  // matches every row. Callers bound the length, this backstops them.
  if (!sanitizedQuery) {
    logger.debug('[PlayerCache] Empty search query after sanitization, skipping query');
    return [];
  }

  logger.debug(`[PlayerCache] Searching players for: "${sanitizedQuery}"`);

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
}

const PLAYER_SEARCH_KEY = 'surfstats:players:search';
const PLAYER_SEARCH_TTL = 300; // 5 minutes

/**
 * Search players from Valkey cache
 * Used by the search page to find players matching a query
 */
export async function searchPlayersFromCache(query: SearchQuery): Promise<PlayerSearchResult[]> {
  // Lowercasing preserves every property the schema enforces, so the key below
  // is still built from a sanitized term.
  const normalizedQuery = query.toLowerCase();
  const cacheKey = `${PLAYER_SEARCH_KEY}:${normalizedQuery}`;

  return cachedFetch(
    cacheKey,
    PLAYER_SEARCH_TTL,
    () => searchPlayersInternal(normalizedQuery),
    {
      lock: true,
      expensive: true,
      onError: (error) => {
        logger.error(`[PlayerCache] Failed to search players: ${getErrorMessage(error)} (code: ${getErrorCode(error)})`);
        return [];
      },
    }
  );
}

/**
 * Internal function to fetch player name
 *
 * Throws on failure; the fallback lives in the caller's `onError`, uncached. The
 * empty name for an unknown SteamID is a real result and stays cached.
 */
async function getPlayerNameInternal(steamid: string): Promise<PlayerNameResult> {
  logger.debug(`[PlayerCache] Fetching player name for: ${steamid}`);

  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT name FROM ck_playerrank WHERE steamid = ?',
    [steamid]
  );

  if (rows.length === 0) {
    logger.warn(`[PlayerCache] No player found with SteamID: ${steamid}`);
    return { name: '' };
  }

  return { name: rows[0].name };
}

const PLAYER_NAME_KEY = 'surfstats:player:name';
const PLAYER_NAME_TTL = 86400; // 24 hours

/**
 * Get player name from Valkey cache
 * Used by generateMetadata and getPlayerData to avoid duplicate queries
 */
export async function getPlayerNameFromCache(steamid: string): Promise<{ name: string }> {
  const cacheKey = `${PLAYER_NAME_KEY}:${steamid}`;

  return cachedFetch(cacheKey, PLAYER_NAME_TTL, () => getPlayerNameInternal(steamid), {
    onError: (error) => {
      logger.error(`[PlayerCache] Failed to fetch player name for ${steamid}: ${getErrorMessage(error)} (code: ${getErrorCode(error)})`);
      return { name: '' };
    },
  });
}
