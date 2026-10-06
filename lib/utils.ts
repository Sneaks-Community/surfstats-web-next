/** Shared utilities, safe in both client and server components. */

/** Display timezone used when `DISPLAY_TZ` is unset or unknown to the runtime. */
export const DEFAULT_DISPLAY_TZ = 'UTC';

/** Whether this runtime's `Intl` knows the IANA zone; boot-time env validation uses it so an
 * unknown `DISPLAY_TZ` fails at startup, not inside a render. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The configured `DISPLAY_TZ`, or UTC. Server only: the env var is undefined in the browser, so client
 * components use `useDisplayTz()`; otherwise the two sides format in different zones and hydration breaks. */
export function getDisplayTz(): string {
  const configured = process.env.DISPLAY_TZ;
  return configured && isValidTimeZone(configured) ? configured : DEFAULT_DISPLAY_TZ;
}

// Cached per timezone: constructing Intl.DateTimeFormat is the expensive part.
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

/** Format a date as `M/D/YYYY` (`N/A` when missing or invalid). `timeZone` is required so server and
 * client render the same day: server callers pass {@link getDisplayTz}, client callers `useDisplayTz()`. */
export function formatDate(date: string | Date | null | undefined, timeZone: string): string {
  if (!date) return 'N/A';
  try {
    return dateFormatter(timeZone).format(new Date(date));
  } catch {
    return 'N/A';
  }
}

/** Fractional seconds to `M:SS.mmm`, e.g. `1:23.456`. */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(3);
  return `${mins}:${secs.padStart(6, '0')}`;
}

/** Seconds behind the WR; `Infinity` without one so those rows sort last. */
export function wrDiff(time: number, wrTime: number | null): number {
  return wrTime ? time - wrTime : Infinity;
}

/** The WR gap rendered as `+M:SS.mmm`, or `-` for the WR itself and no-WR rows. */
export function formatTimeDiff(time: number, wrTime: number | null): string {
  if (!wrTime || time === wrTime) return '-';
  return `+${formatTime(time - wrTime)}`;
}

/** Rows per page in the client-side record tables (map, bonus, stage, player). */
export const ITEMS_PER_PAGE = 20;

/** Page size (and max) for the record/stage/bonus endpoints; keeps cache entries under 2MB.
 * The map page's first page, those routes and the client load-all loop must agree, and clients
 * can't import `server-only` `api-utils`, so it lives here and is re-exported there. */
export const RECORDS_PAGE_SIZE = 100;

/** Newest connections the activity heatmap considers. Lives here, not in the `server-only`
 * analytics module, because the client chart states the cap in its subtitle. */
export const HEATMAP_MAX_SESSIONS = 10000;

export type SortDirection = 'asc' | 'desc';

export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || 'SurfStats';

/** Whether a map is staged rather than linear; client-safe so the map page's tabs match the server.
 * `stages` is `COUNT(*) + 1` over stage zones (linear 0, staged >= 2, never 1); route every check
 * through here so a query change can't split the filter from the badge. */
export function isStagedMap(metadata: { stages: number }): boolean {
  return metadata.stages > 1;
}

/** Shortest search that reaches the DB. It counts the sanitized query, so `ab'` gets empty results,
 * not an error. */
export const MIN_SEARCH_LENGTH = 3;

/** Parse a URL page/index param: NaN returns `fallback`, anything else clamps to `[min, max]`,
 * so `?page=abc`, `-5` or huge values never become NaN or negative offsets. */
export function parseIntParam(
  value: string | null | undefined,
  { fallback = 1, min = 1, max = Number.MAX_SAFE_INTEGER }: { fallback?: number; min?: number; max?: number } = {}
): number {
  const n = parseInt(value ?? String(fallback), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Sorted copy (input not mutated). `comparator` gives ascending order and is negated for `desc`,
 * so call sites only supply the field comparison. */
export function sortRecords<T>(
  records: readonly T[],
  direction: SortDirection,
  comparator: (a: T, b: T) => number
): T[] {
  const sorted = [...records];
  sorted.sort((a, b) => (direction === 'asc' ? comparator(a, b) : -comparator(a, b)));
  return sorted;
}

/** Case-insensitive substring match of a raw (not lowercased) query against any field. */
export function matchesQuery(query: string, ...fields: string[]): boolean {
  const q = query.toLowerCase();
  return fields.some((field) => field.toLowerCase().includes(q));
}

/** Total time on server as `Xd Yh Zm`, e.g. `5d 3h 20m` (days omitted when 0). */
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

/** Seconds as `Xh Ym`, e.g. `125h 30m`, for the playtime toggle. */
export function formatPlaytimeToggle(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return `${hours.toLocaleString()}h ${minutes}m`;
}

const DEFAULT_MAP_IMAGES_URL = 'https://image.gametracker.com/images/maps/160x120/csgo/';

/** Map-thumbnail base URL: `MAP_IMAGES_URL`, else the default CDN. The env var is server only,
 * so client callers always get the default. */
export function getMapImagesUrl(): string {
  return process.env.MAP_IMAGES_URL || DEFAULT_MAP_IMAGES_URL;
}

/** Build `${baseUrl}${map}.jpg`, replacing characters outside `mapNameSchema`'s charset with `_`
 * so every call site builds the same well-formed URL. */
export function mapImageUrl(baseUrl: string, map: string | null | undefined): string {
  const safeMap = (map ?? '').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${baseUrl}${safeMap}.jpg`;
}

/** Whether a live server's map is a surf map; other servers' maps (KZ, Bhop) have no map page. */
export function isSurfMap(map: string | null | undefined): map is `surf_${string}` {
  return !!map && map.startsWith('surf_');
}