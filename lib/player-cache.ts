import 'server-only';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import logger from '@/lib/logger';
import { getPlayerCountFromCache } from '@/lib/registry-cache';
import type { SearchQuery } from './validators';
import { ITEMS_PER_PAGE } from './utils';
import { cachedFetch } from './cached-fetch';
import { cacheSet } from './valkey-cache';
import { getErrorCode, getErrorMessage } from './errors';

// The read path and the background warmer must agree exactly.
const PLAYERS_LIST_TTL = 3600; // 1 hour

/** `search` is the sanitized term; the default (no-search) listing passes `''`. */
function playersListKey(page: number, search: string): string {
  return `surfstats:players:list:${page}:${search}`;
}

export interface PlayerRank extends RowDataPacket {
  steamid: string;
  name: string;
  country: string;
  points: number;
  finishedmaps: number;
  lastseen: string;
  rank: number;
}

export interface PlayerSearchResult {
  steamid: string;
  name: string;
  points: number;
}

export interface PlayerNameResult {
  name: string;
}

export interface PlayersResult {
  players: PlayerRank[];
  total: number;
  totalPages: number;
}

/** Last players-list page, from the cached player count. Routes clamp `?page=` to it so an
 * out-of-range value can't mint a fresh cache key or a huge OFFSET. */
export async function getPlayerPageCeiling(): Promise<number> {
  const total = await getPlayerCountFromCache();
  return Math.max(1, Math.ceil(total / ITEMS_PER_PAGE));
}

/** Throws on failure; the fallback lives in the caller's `onError`, uncached. */
async function fetchPlayersInternal(
  page: number,
  sanitizedSearch: SearchQuery
): Promise<PlayersResult> {
  logger.debug(`[PlayerCache] Fetching players list (page: ${page}, search: "${sanitizedSearch || 'none'}")`);

  const limit = ITEMS_PER_PAGE;
  const offset = (page - 1) * limit;

  // RANK() OVER, not a correlated COUNT subquery: O(n log n) vs O(n^2). finishedmaps is the
  // game server's column; a COUNT over ck_playertimes cost ~5.5s per uncached page.
  let query: string;
  const params: Array<string | number> = [];

  if (sanitizedSearch) {
    // Rank all points > 0 rows, then filter in the outer WHERE: RANK() runs after the inner WHERE,
    // so filtering there would rank only the matches (1, 2, 3...), not the global rank.
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

  let total: number;
  if (sanitizedSearch) {
    const countQuery = `SELECT COUNT(*) as total FROM ck_playerrank WHERE points > 0 AND (name LIKE ? OR steamid LIKE ?)`;
    const countParams = [`%${sanitizedSearch}%`, `%${sanitizedSearch}%`];
    const [countRows] = await pool.query<RowDataPacket[]>(countQuery, countParams);
    total = countRows[0].total;
  } else {
    total = await getPlayerCountFromCache();
  }

  logger.debug(`[PlayerCache] Retrieved ${rows.length} players (page ${page} of ${Math.ceil(total / limit)}, ${total} total)`);

  return { players: rows, total, totalPages: Math.ceil(total / limit) };
}

export async function getPlayersFromCache(
  page: number,
  search: SearchQuery
): Promise<{
  players: PlayerRank[];
  total: number;
  totalPages: number;
}> {
  // `search` is sanitized by its type; the page still needs bounding so a malformed value
  // can't spawn arbitrary distinct keys.
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

/** Pre-fills the first `pageCount` no-search pages (run by the players-list refresher) so browsing
 * never runs the full-table rank query. One indexed top-k query, ranked in JS: exact RANK(), as
 * the slice starts at the top. */
export async function warmPlayersListCache(pageCount: number): Promise<void> {
  const pageSize = ITEMS_PER_PAGE;
  const k = Math.max(1, pageCount) * pageSize;

  const [rows] = await pool.query<PlayerRank[]>(
    `SELECT steamid, name, country, points, finishedmaps, lastseen
     FROM ck_playerrank
     WHERE points > 0
     ORDER BY points DESC
     LIMIT ?`,
    [k]
  );

  // Ties share a rank; the next distinct value jumps to its position.
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
    // Same key builder as the read path, so the warmed key can't drift.
    await cacheSet(playersListKey(page, ''), { players, total, totalPages }, PLAYERS_LIST_TTL);
  }

  logger.debug(`[PlayerCache] Warmed ${Math.min(pageCount, Math.ceil(ranked.length / pageSize))} players-list page(s) from top ${ranked.length} players`);
}

/** Throws on failure; the fallback lives in the caller's `onError`, uncached. */
async function searchPlayersInternal(sanitizedQuery: string): Promise<PlayerSearchResult[]> {
  // An empty term would be `LIKE '%%'`, a full scan matching every row. Callers bound the
  // length; this backstops them.
  if (!sanitizedQuery) {
    logger.debug('[PlayerCache] Empty search query after sanitization, skipping query');
    return [];
  }

  logger.debug(`[PlayerCache] Searching players for: "${sanitizedQuery}"`);

  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT steamid, name, points
    FROM ck_playerrank
    WHERE points > 0 AND (name LIKE ? OR steamid LIKE ?)
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

/** Search-page lookup by name or SteamID. */
export async function searchPlayersFromCache(query: SearchQuery): Promise<PlayerSearchResult[]> {
  // Lowercasing keeps the schema's guarantees, so the key is still sanitized.
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

/** Throws on failure (fallback uncached); an unknown SteamID's empty name is cached. */
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

/** Shared by generateMetadata and getPlayerData so a profile render queries the name once. */
export async function getPlayerNameFromCache(steamid: string): Promise<{ name: string }> {
  const cacheKey = `${PLAYER_NAME_KEY}:${steamid}`;

  return cachedFetch(cacheKey, PLAYER_NAME_TTL, () => getPlayerNameInternal(steamid), {
    onError: (error) => {
      logger.error(`[PlayerCache] Failed to fetch player name for ${steamid}: ${getErrorMessage(error)} (code: ${getErrorCode(error)})`);
      return { name: '' };
    },
  });
}
