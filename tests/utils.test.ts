import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatPlaytime,
  formatPlaytimeToggle,
  formatTime,
  mapImageUrl,
  matchesQuery,
  parseIntParam,
  sortRecords,
  wrDiff,
  formatTimeDiff,
  isValidTimeZone,
  getDisplayTz,
  DEFAULT_DISPLAY_TZ,
} from '../lib/utils';

// Every page route clamps `?page=` through this; a NaN must never reach an
// OFFSET calculation.
describe('parseIntParam', () => {
  it('falls back on missing or non-numeric input', () => {
    expect(parseIntParam(undefined)).toBe(1);
    expect(parseIntParam(null)).toBe(1);
    expect(parseIntParam('abc')).toBe(1);
    expect(parseIntParam('', { fallback: 7 })).toBe(7);
  });

  it('clamps to the range', () => {
    expect(parseIntParam('-5')).toBe(1);
    expect(parseIntParam('9999999', { max: 42 })).toBe(42);
    expect(parseIntParam('3', { min: 5 })).toBe(5);
    expect(parseIntParam('0', { min: 0 })).toBe(0);
  });

  it('takes the leading integer of a mixed value', () => {
    expect(parseIntParam('12abc')).toBe(12);
    expect(parseIntParam('3.9')).toBe(3);
  });
});

describe('formatTime', () => {
  it('pads seconds so times sort and align', () => {
    expect(formatTime(65.5)).toBe('1:05.500');
    expect(formatTime(9.123)).toBe('0:09.123');
    expect(formatTime(0)).toBe('0:00.000');
    expect(formatTime(605.789)).toBe('10:05.789');
    expect(formatTime(3600)).toBe('60:00.000');
  });
});

describe('formatPlaytime', () => {
  it('omits days only when there are none', () => {
    expect(formatPlaytime(0)).toBe('0h 0m');
    expect(formatPlaytime(3600)).toBe('1h 0m');
    expect(formatPlaytime(451_200)).toBe('5d 5h 20m');
    expect(formatPlaytimeToggle(451_200)).toBe('125h 20m');
  });
});

// The zone is an explicit argument, so a server render and the client's
// re-render cannot disagree by silently falling back to different defaults.
describe('formatDate', () => {
  it('formats in the given zone and survives bad input', () => {
    // month and day are both 'numeric', so neither is zero-padded
    expect(formatDate('2026-02-24T19:15:18.000Z', 'UTC')).toBe('2/24/2026');
    expect(formatDate(new Date('2026-01-01T00:00:00.000Z'), 'UTC')).toBe('1/1/2026');
    expect(formatDate('2026-12-31T23:59:59.000Z', 'UTC')).toBe('12/31/2026');
    expect(formatDate(null, 'UTC')).toBe('N/A');
    expect(formatDate('', 'UTC')).toBe('N/A');
    expect(formatDate('not a date', 'UTC')).toBe('N/A');
  });

  it('renders the same instant on a different calendar day per zone', () => {
    // 00:30 UTC is still the previous evening in New York.
    expect(formatDate('2026-03-10T00:30:00.000Z', 'UTC')).toBe('3/10/2026');
    expect(formatDate('2026-03-10T00:30:00.000Z', 'America/New_York')).toBe('3/9/2026');
  });

  it('falls back to N/A rather than throwing on an unknown zone', () => {
    expect(formatDate('2026-02-24T19:15:18.000Z', 'Not/AZone')).toBe('N/A');
  });
});

describe('isValidTimeZone / getDisplayTz', () => {
  it('accepts real IANA zones and rejects junk', () => {
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('reads DISPLAY_TZ, falling back to UTC when unset or unknown', () => {
    const original = process.env.DISPLAY_TZ;
    try {
      delete process.env.DISPLAY_TZ;
      expect(getDisplayTz()).toBe(DEFAULT_DISPLAY_TZ);

      process.env.DISPLAY_TZ = 'Europe/Berlin';
      expect(getDisplayTz()).toBe('Europe/Berlin');

      // An invalid value would otherwise throw inside a render.
      process.env.DISPLAY_TZ = 'Not/AZone';
      expect(getDisplayTz()).toBe(DEFAULT_DISPLAY_TZ);
    } finally {
      if (original === undefined) delete process.env.DISPLAY_TZ;
      else process.env.DISPLAY_TZ = original;
    }
  });
});

describe('mapImageUrl', () => {
  it('replaces anything outside the map-name charset', () => {
    expect(mapImageUrl('https://cdn/', 'surf_utopia')).toBe('https://cdn/surf_utopia.jpg');
    expect(mapImageUrl('https://cdn/', '../../etc/passwd')).toBe(
      'https://cdn/______etc_passwd.jpg'
    );
    expect(mapImageUrl('https://cdn/', null)).toBe('https://cdn/.jpg');
  });
});

describe('sortRecords and matchesQuery', () => {
  it('sorts a copy in both directions', () => {
    const rows = [{ n: 2 }, { n: 1 }, { n: 3 }];
    const asc = sortRecords(rows, 'asc', (a, b) => a.n - b.n);

    expect(asc.map((r) => r.n)).toEqual([1, 2, 3]);
    expect(sortRecords(rows, 'desc', (a, b) => a.n - b.n).map((r) => r.n)).toEqual([3, 2, 1]);
    expect(rows.map((r) => r.n)).toEqual([2, 1, 3]);
  });

  it('matches case-insensitively across fields', () => {
    expect(matchesQuery('UTOPIA', 'surf_utopia', 'author')).toBe(true);
    expect(matchesQuery('nope', 'surf_utopia', 'author')).toBe(false);
  });
});

// Shared by both record tables, three of those call sites as sort comparators.
describe('wrDiff and formatTimeDiff', () => {
  it('sorts records with no WR last, whichever direction', () => {
    const rows = [
      { time: 70, wr: 60 },
      { time: 65, wr: null },
      { time: 61, wr: 60 },
    ];
    const sorted = sortRecords(rows, 'asc', (a, b) => wrDiff(a.time, a.wr) - wrDiff(b.time, b.wr));

    expect(sorted.map(r => r.time)).toEqual([61, 70, 65]);
  });

  it('renders the gap, and a dash for the record itself', () => {
    expect(formatTimeDiff(70, 60)).toBe('+0:10.000');
    expect(formatTimeDiff(60, 60)).toBe('-');
    expect(formatTimeDiff(70, null)).toBe('-');
  });
});
