/** Input validation schemas (Zod v4) and the wrapper functions callers use. */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

/** SteamID schema: validates STEAM_1:X:Y format or numeric SteamID64 */
export const steamIdSchema = z.string().trim().min(1).max(64).regex(
  /^(STEAM_[0-5]:[0-1]:[0-9]+|[0-9]+)$/,
  'Invalid SteamID format',
);

/** Map name schema: alphanumeric, underscore, hyphen only */
export const mapNameSchema = z.string().trim().min(1).max(128).regex(
  /^[a-zA-Z0-9_-]+$/,
  'Map name contains invalid characters',
);

/**
 * Search query schema: printable ASCII, XSS-safe, SQL LIKE-percent-escaped.
 *
 * The transform pipeline removes potentially dangerous characters, normalizes
 * whitespace, and escapes the SQL `%` LIKE wildcard.
 *
 * Note: Underscore (`_`) is intentionally NOT escaped. It remains a valid
 * character in search queries so users can search for maps with underscores
 * in their names (e.g., `surf_1day`). The `_` wildcard is harmless —
 * it matches exactly one character and cannot be used for data extraction
 * or injection attacks. Parameterized queries provide the real SQL injection
 * protection.
 */
export const searchQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[\x20-\x7E]+$/, 'Search query contains invalid characters')
  .transform((query) => {
    // Remove characters that could be used for XSS or injection
    let sanitized = query.replace(/[<>"'&;\\]/g, '');
    // Normalize whitespace
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    // Escape SQL LIKE `%` wildcard to prevent LIKE wildcard injection
    sanitized = sanitized.replace(/%/g, '\\%');
    return sanitized;
  });

// ---------------------------------------------------------------------------
// Wrapper Functions
// ---------------------------------------------------------------------------

/**
 * Validate a SteamID input.
 * @param steamid - The SteamID to validate
 * @returns Sanitized SteamID or null if invalid
 */
export function validateSteamId(steamid: string): string | null {
  const result = steamIdSchema.safeParse(steamid);
  return result.success ? result.data : null;
}

/**
 * Validate a map name input.
 * @param mapname - The map name to validate
 * @returns Sanitized map name or null if invalid
 */
export function validateMapName(mapname: string): string | null {
  const result = mapNameSchema.safeParse(mapname);
  return result.success ? result.data : null;
}

/**
 * A search term that has been through {@link validateSearchQuery}. Cache
 * functions take this rather than `string`, so the compiler enforces what the
 * repeated runtime calls used to approximate.
 */
export type SearchQuery = string & { readonly __brand: 'SearchQuery' };

/**
 * Validate and sanitize a search query.
 * @param query - The search query to sanitize
 * @returns Sanitized search query or empty string
 */
export function validateSearchQuery(query: string | undefined): SearchQuery {
  if (!query || typeof query !== 'string') return '' as SearchQuery;
  const result = searchQuerySchema.safeParse(query);
  return (result.success ? result.data : '') as SearchQuery;
}

/** The no-search listing, minted rather than cast so `''` needs no exception. */
export const EMPTY_SEARCH = validateSearchQuery('');

/**
 * A player name for display. React escapes it; this only trims, and stands in
 * 'Unknown' for a missing, blank or over-64-character name.
 */
export function validatePlayerName(name: string | null | undefined): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed && trimmed.length <= 64 ? trimmed : 'Unknown';
}
