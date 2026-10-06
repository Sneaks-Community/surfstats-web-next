import { z } from 'zod';

export const steamIdSchema = z.string().trim().min(1).max(64).regex(
  /^(STEAM_[0-5]:[0-1]:[0-9]+|[0-9]+)$/,
  'Invalid SteamID format',
);

export const mapNameSchema = z.string().trim().min(1).max(128).regex(
  /^[a-zA-Z0-9_-]+$/,
  'Map name contains invalid characters',
);

/** `_` is left unescaped so `surf_1day` matches; parameterized queries guard injection. */
export const searchQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[\x20-\x7E]+$/, 'Search query contains invalid characters')
  .transform((query) => {
    let sanitized = query.replace(/[<>"'&;\\]/g, '');
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    // LIKE escape; `\` too, so it can't unescape a `%`
    sanitized = sanitized.replace(/[\\%]/g, '\\$&');
    return sanitized;
  });

export function validateSteamId(steamid: string): string | null {
  const result = steamIdSchema.safeParse(steamid);
  return result.success ? result.data : null;
}

export function validateMapName(mapname: string): string | null {
  const result = mapNameSchema.safeParse(mapname);
  return result.success ? result.data : null;
}

/** Only {@link validateSearchQuery} produces this, so cache functions can't take an unvalidated term. */
export type SearchQuery = string & { readonly __brand: 'SearchQuery' };

/** Returns '' for missing or invalid input. */
export function validateSearchQuery(query: string | undefined): SearchQuery {
  if (!query || typeof query !== 'string') return '' as SearchQuery;
  const result = searchQuerySchema.safeParse(query);
  return (result.success ? result.data : '') as SearchQuery;
}

export const EMPTY_SEARCH = validateSearchQuery('');

/** Trimmed name, or 'Unknown' if missing, blank or over 64 chars. React escapes it on render. */
export function validatePlayerName(name: string | null | undefined): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed && trimmed.length <= 64 ? trimmed : 'Unknown';
}
