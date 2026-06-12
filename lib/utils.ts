/**
 * Utility functions shared across the application
 * These functions are safe to use in both client and server components
 */

// Pre-created formatter for better performance (avoids creating new Intl.DateTimeFormat on each call)
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: '2-digit',
  day: 'numeric',
});

/**
 * Format a date string into localized format
 * @param date - Date string or Date object
 * @returns Formatted date string (e.g., "01/15/2024")
 */
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return 'N/A';
  try {
    return dateFormatter.format(new Date(date));
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