import 'server-only';

/**
 * Input sanitization utilities for security
 */

// Allowed characters for SteamID format: STEAM_1:0:12345 or numeric SteamID64
const STEAMID_REGEX = /^(STEAM_[0-5]:[0-1]:[0-9]+|[0-9]+)$/;

// Allowed characters for map names (alphanumeric, underscore, hyphen)
const MAPNAME_REGEX = /^[a-zA-Z0-9_-]+$/;

// Allowed characters for search queries (printable ASCII)
const SEARCH_REGEX = /^[\x20-\x7E]+$/;

// Maximum lengths for various inputs
const MAX_STEAMID_LENGTH = 64;
const MAX_MAPNAME_LENGTH = 128;
const MAX_SEARCH_LENGTH = 100;

/**
 * Sanitize and validate a SteamID input
 * @param steamid - The SteamID to validate
 * @returns Sanitized SteamID or null if invalid
 */
export function sanitizeSteamId(steamid: string): string | null {
  if (!steamid || typeof steamid !== 'string') {
    return null;
  }
  
  const trimmed = steamid.trim();
  
  if (trimmed.length === 0 || trimmed.length > MAX_STEAMID_LENGTH) {
    return null;
  }
  
  if (!STEAMID_REGEX.test(trimmed)) {
    return null;
  }
  
  return trimmed;
}

/**
 * Sanitize and validate a map name input
 * @param mapname - The map name to validate
 * @returns Sanitized map name or null if invalid
 */
export function sanitizeMapName(mapname: string): string | null {
  if (!mapname || typeof mapname !== 'string') {
    return null;
  }
  
  const trimmed = mapname.trim();
  
  if (trimmed.length === 0 || trimmed.length > MAX_MAPNAME_LENGTH) {
    return null;
  }
  
  if (!MAPNAME_REGEX.test(trimmed)) {
    return null;
  }
  
  return trimmed;
}

/**
 * Sanitize and validate a search query input
 * @param query - The search query to sanitize
 * @returns Sanitized search query or empty string
 */
export function sanitizeSearchQuery(query: string | undefined): string {
  if (!query || typeof query !== 'string') {
    return '';
  }
  
  // Trim and limit length
  let sanitized = query.trim().slice(0, MAX_SEARCH_LENGTH);
  
  // Remove any non-printable or special characters
  sanitized = sanitized
    .replace(/[<>\"'&;\\]/g, '') // Remove potential XSS/Injection characters
    .replace(/\s+/g, ' ')        // Normalize whitespace
    .trim();
  
  // Validate against allowed characters
  if (!SEARCH_REGEX.test(sanitized)) {
    return '';
  }
  
  return sanitized;
}

/**
 * Sanitize a player name (for display purposes)
 * Note: Player names are displayed, not used in queries, so this is for XSS prevention
 * @param name - The player name to sanitize
 * @returns Sanitized name safe for HTML display
 */
export function sanitizePlayerName(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') {
    return 'Unknown';
  }
  
  // Remove HTML/script tags and special characters that could be used for XSS
  return name
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .slice(0, 64) // Limit length
    .trim() || 'Unknown';
}
