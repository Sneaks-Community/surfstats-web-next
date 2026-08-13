/**
 * Utility functions shared across the application
 * These functions are safe to use in both client and server components
 */

/** Display timezone used when `DISPLAY_TZ` is unset or unknown to the runtime. */
export const DEFAULT_DISPLAY_TZ = 'UTC';

/**
 * True when this runtime's `Intl` recognises the IANA zone.
 *
 * Used by boot-time env validation so an unknown `DISPLAY_TZ` fails loudly at
 * startup instead of throwing inside a render.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The configured display timezone (`DISPLAY_TZ`), or UTC.
 *
 * Server-side only: `process.env.DISPLAY_TZ` is undefined in the browser, so
 * client components must take the value from `useDisplayTz()` instead of calling
 * this — otherwise the server and the client would format the same date in two
 * different zones and hydration would mismatch.
 */
export function getDisplayTz(): string {
  const configured = process.env.DISPLAY_TZ;
  return configured && isValidTimeZone(configured) ? configured : DEFAULT_DISPLAY_TZ;
}

// Formatters are cached per timezone: constructing Intl.DateTimeFormat is the
// expensive part, and there is only ever one zone in practice.
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      timeZone,
    });
    dateFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * Format a date string into localized format
 *
 * `timeZone` is required rather than defaulting: a client component that fell
 * back to UTC while the server used `DISPLAY_TZ` would render a different day
 * either side of hydration. Server callers pass {@link getDisplayTz}, client
 * callers pass `useDisplayTz()`.
 *
 * @param date - Date string or Date object
 * @param timeZone - IANA timezone to render in
 * @returns Formatted date string (e.g., "1/15/2024")
 */
export function formatDate(date: string | Date | null | undefined, timeZone: string): string {
  if (!date) return 'N/A';
  try {
    return dateFormatter(timeZone).format(new Date(date));
  } catch {
    return 'N/A';
  }
}

/**
 * Format seconds into a time string (MM:SS.mmm format)
 * @param seconds - Time in seconds (can include milliseconds as decimal)
 * @returns Formatted time string (e.g., "1:23.456" or "10:05.789")
 */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(3);
  return `${mins}:${secs.padStart(6, '0')}`;
}

/**
 * Seconds behind the world record, or `Infinity` when there is none, so records
 * without a WR sort last instead of first.
 */
export function wrDiff(time: number, wrTime: number | null): number {
  return wrTime ? time - wrTime : Infinity;
}

/** The same gap rendered: `+M:SS.mmm`, or `-` for the WR itself and no-WR rows. */
export function formatTimeDiff(time: number, wrTime: number | null): string {
  if (!wrTime || time === wrTime) return '-';
  return `+${formatTime(time - wrTime)}`;
}

/** Rows per page in the client-side record tables (map, bonus, stage, player). */
export const ITEMS_PER_PAGE = 20;

/**
 * Rows per page (and the max) for the record/stage/bonus endpoints; keeps cache
 * entries under 2MB. The map page's first page, those routes and the client's
 * load-all loop all have to agree, and a client component cannot import the
 * `server-only` `api-utils`, so the value lives here and is re-exported there.
 */
export const RECORDS_PAGE_SIZE = 100;

/**
 * Newest connections the activity heatmap considers. Lives here, not in the
 * `server-only` analytics module, because the chart states the cap in its
 * subtitle and a client component cannot import that module.
 */
export const HEATMAP_MAX_SESSIONS = 10000;

export type SortDirection = 'asc' | 'desc';

/**
 * Parse an integer from a URL search param (or any nullable string), guarding
 * against NaN and clamping to a range. Use for page/index params so malformed
 * input (`?page=abc`, `?page=-5`, huge values) falls back/clamps instead of
 * producing NaN or negative offsets.
 * @param value - Raw param value (e.g. searchParams.get('page'))
 * @param options - fallback (default 1), min (default 1), max (default MAX_SAFE_INTEGER)
 */
export function parseIntParam(
  value: string | null | undefined,
  { fallback = 1, min = 1, max = Number.MAX_SAFE_INTEGER }: { fallback?: number; min?: number; max?: number } = {}
): number {
  const n = parseInt(value ?? String(fallback), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Clone a list and sort it with an ascending-order comparator, applying the
 * sort direction. Keeps the "copy, sort, flip on desc" boilerplate in one place
 * so call sites only supply the field comparator.
 * @param records - Records to sort (not mutated)
 * @param direction - 'asc' keeps the comparator order, 'desc' reverses it
 * @param comparator - Returns the ascending comparison for two records
 */
export function sortRecords<T>(
  records: readonly T[],
  direction: SortDirection,
  comparator: (a: T, b: T) => number
): T[] {
  const sorted = [...records];
  sorted.sort((a, b) => (direction === 'asc' ? comparator(a, b) : -comparator(a, b)));
  return sorted;
}

/**
 * Case-insensitive substring match of a search query against one or more fields.
 * @param query - Raw (un-lowercased) search query
 * @param fields - Field values to test
 * @returns true when the query is found in any field
 */
export function matchesQuery(query: string, ...fields: string[]): boolean {
  const q = query.toLowerCase();
  return fields.some((field) => field.toLowerCase().includes(q));
}

/**
 * Format playtime duration in seconds to days, hours, and minutes format
 * Used for displaying total time on server from player analytics
 * @param seconds - Total time in seconds
 * @returns Formatted string in "Xd Yh Zm" format (e.g., "5d 3h 20m", "1d 12h 0m")
 */
export function formatPlaytime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  const parts: string[] = [];
  if (days > 0) parts.push(`${days.toLocaleString()}d`);
  parts.push(`${hours.toLocaleString()}h`);
  parts.push(`${minutes}m`);
  
  return parts.join(' ');
}

/**
 * Format seconds into hours and minutes for toggle display
 * @param seconds - Total time in seconds
 * @returns Formatted string in "Xh Ym" format (e.g., "125h 30m")
 */
export function formatPlaytimeToggle(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return `${hours.toLocaleString()}h ${minutes}m`;
}

/** Default map-thumbnail CDN base, used when `MAP_IMAGES_URL` is unset. */
const DEFAULT_MAP_IMAGES_URL = 'https://image.gametracker.com/images/maps/160x120/csgo/';

/**
 * Resolve the base URL for map thumbnails.
 *
 * Reads `MAP_IMAGES_URL` (server env) and falls back to the shared default.
 * On the client `process.env.MAP_IMAGES_URL` is undefined, so callers there
 * always receive the default — matching the previous per-call-site fallbacks.
 *
 * @returns The map-images base URL
 */
export function getMapImagesUrl(): string {
  return process.env.MAP_IMAGES_URL || DEFAULT_MAP_IMAGES_URL;
}

/**
 * Build a map thumbnail image URL
 *
 * Sanitizes the name to the allowed map-name charset (`[a-zA-Z0-9_-]`, matching
 * `mapNameSchema`) before interpolating it, replacing any other character with
 * `_`. It guarantees every call site builds the URL the same way so stray
 * characters can't produce malformed or unexpected URLs.
 *
 * @param baseUrl - The `MAP_IMAGES_URL` base (may be an empty string)
 * @param map - The map name (may be null/undefined)
 * @returns The sanitized `${baseUrl}${map}.jpg` URL
 */
export function mapImageUrl(baseUrl: string, map: string | null | undefined): string {
  const safeMap = (map ?? '').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${baseUrl}${safeMap}.jpg`;
}