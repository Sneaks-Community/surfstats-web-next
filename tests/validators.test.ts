import { describe, expect, it } from 'vitest';
import {
  validateMapName,
  validatePlayerName,
  validateSearchQuery,
  validateSteamId,
} from '../lib/validators';

describe('validateSteamId', () => {
  it('accepts SteamID2 and SteamID64', () => {
    expect(validateSteamId('STEAM_1:0:12345')).toBe('STEAM_1:0:12345');
    expect(validateSteamId('STEAM_0:1:7')).toBe('STEAM_0:1:7');
    expect(validateSteamId('76561197960287930')).toBe('76561197960287930');
    expect(validateSteamId('  STEAM_1:0:12345  ')).toBe('STEAM_1:0:12345');
  });

  it('rejects malformed input', () => {
    for (const bad of ['', 'STEAM_1:2:5', 'STEAM_6:0:5', "STEAM_1:0:1' OR 1=1", 'abc']) {
      expect(validateSteamId(bad)).toBeNull();
    }
  });
});

describe('validateMapName', () => {
  it('accepts the ckSurf charset and rejects anything else', () => {
    expect(validateMapName('surf_beginner_hell')).toBe('surf_beginner_hell');
    expect(validateMapName('surf-utopia-v3')).toBe('surf-utopia-v3');
    expect(validateMapName('')).toBeNull();
    expect(validateMapName('foo.bar')).toBeNull();
    expect(validateMapName('surf_%')).toBeNull();
    expect(validateMapName('a'.repeat(129))).toBeNull();
  });
});

describe('validateSearchQuery', () => {
  it('sanitizes without rejecting ordinary queries', () => {
    expect(validateSearchQuery('surf')).toBe('surf');
    expect(validateSearchQuery('  surf   utopia ')).toBe('surf utopia');
    expect(validateSearchQuery('surf_1day')).toBe('surf_1day');
  });

  // COR-4: length was checked before sanitizing, so junk that sanitized away
  // reached the DB as LIKE '%%' and matched every row in ck_playerrank.
  it('strips dangerous characters, which can empty the query entirely', () => {
    expect(validateSearchQuery('<<<<')).toBe('');
    expect(validateSearchQuery('&&&&&')).toBe('');
    expect(validateSearchQuery('<script>x')).toBe('scriptx');
  });

  it('escapes the LIKE wildcard but leaves underscore alone', () => {
    expect(validateSearchQuery('100%')).toBe('100\\%');
    expect(validateSearchQuery('a_b')).toBe('a_b');
  });

  it('returns an empty string for missing or oversized input', () => {
    expect(validateSearchQuery(undefined)).toBe('');
    expect(validateSearchQuery('')).toBe('');
    expect(validateSearchQuery('a'.repeat(101))).toBe('');
    expect(validateSearchQuery('café')).toBe('');
  });
});

describe('validatePlayerName', () => {
  it('falls back to Unknown and truncates', () => {
    expect(validatePlayerName('bhop enjoyer')).toBe('bhop enjoyer');
    expect(validatePlayerName(null)).toBe('Unknown');
    expect(validatePlayerName(undefined)).toBe('Unknown');
    expect(validatePlayerName('')).toBe('Unknown');
    expect(validatePlayerName('n'.repeat(65))).toBe('Unknown');
  });
});
