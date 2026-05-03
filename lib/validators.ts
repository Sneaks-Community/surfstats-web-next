/**
 * Input validation schemas and wrapper functions using Zod v4.
 * Replaces the custom sanitization logic from lib/sanitize.ts.
 *
 * All wrapper functions maintain backward-compatible signatures
 * (same parameter types and return types) to minimize migration surface area.
 */

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

/** Player name schema: safe for display (truncates to 64 chars) */
export const playerNameSchema = z
  .string()
  .trim()
  .max(64)
  .or(z.literal(''))
  .default('Unknown');

// ---------------------------------------------------------------------------
// Wrapper Functions (backward-compatible with lib/sanitize.ts signatures)
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
 * Validate and sanitize a search query.
 * @param query - The search query to sanitize
 * @returns Sanitized search query or empty string
 */
export function validateSearchQuery(query: string | undefined): string {
  if (!query || typeof query !== 'string') return '';
  const result = searchQuerySchema.safeParse(query);
  return result.success ? result.data : '';
}

/**
 * Sanitize a player name for display.
 * @param name - The player name to sanitize
 * @returns Sanitized name safe for display
 */
export function validatePlayerName(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return 'Unknown';
  const result = playerNameSchema.safeParse(name);
  return result.success ? result.data : 'Unknown';
}
