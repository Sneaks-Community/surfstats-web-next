import { describe, expect, it } from 'vitest';
import {
  UNKNOWN_COUNTRY_CODE,
  getCountryCodeFromName,
  getCountryNamesFromCode,
  getNumericCodeFromAlpha2,
  getPrimaryCountryName,
  isValidCountryCode,
} from '../lib/countries';

describe('getCountryCodeFromName', () => {
  it('resolves plain and mis-cased ISO names', () => {
    expect(getCountryCodeFromName('United States')).toBe('US');
    expect(getCountryCodeFromName('thailand')).toBe('TH');
    expect(getCountryCodeFromName('  Germany  ')).toBe('DE');
  });

  // GeoIP stores the article form; missing this dropped the largest country
  // from every country view.
  it('strips a leading "The"', () => {
    expect(getCountryCodeFromName('The United States')).toBe('US');
    expect(getCountryCodeFromName('The Russian Federation')).toBe('RU');
    expect(getCountryCodeFromName('The Republic of Moldova')).toBe('MD');
  });

  it('uses the override table for names the ISO dataset misses', () => {
    expect(getCountryCodeFromName('Scotland')).toBe('GB');
    expect(getCountryCodeFromName('Korea')).toBe('KR');
  });

  it('returns UN rather than fabricating a code', () => {
    expect(getCountryCodeFromName('Narnia')).toBe(UNKNOWN_COUNTRY_CODE);
    expect(getCountryCodeFromName('')).toBe(UNKNOWN_COUNTRY_CODE);
    expect(getCountryCodeFromName('   ')).toBe(UNKNOWN_COUNTRY_CODE);
  });

  // The override table is a plain object, so a truthiness lookup would hand back
  // an inherited Function and the `string` return type would lie.
  it('does not resolve Object.prototype members', () => {
    for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      const code = getCountryCodeFromName(name);
      expect(typeof code).toBe('string');
      expect(code).toBe(UNKNOWN_COUNTRY_CODE);
    }
  });
});

describe('code lookups', () => {
  it('maps codes to names, numerics, and validity', () => {
    expect(getPrimaryCountryName('us')).toBe('United States of America');
    expect(getPrimaryCountryName('ZZ')).toBeUndefined();
    expect(getNumericCodeFromAlpha2('US')).toBe('840');
    expect(getNumericCodeFromAlpha2('AL')).toBe('008');
    expect(getNumericCodeFromAlpha2(UNKNOWN_COUNTRY_CODE)).toBeUndefined();
    expect(isValidCountryCode('GB')).toBe(true);
    expect(isValidCountryCode('ZZ')).toBe(false);
  });

  // Drives the OR'd WHERE clause on the country pages, so a missing variation
  // silently loses players.
  it('returns every spelling a country page must match', () => {
    const names = getCountryNamesFromCode('GB');

    expect(names).toContain('scotland');
    expect(names).toContain('england');
    expect(names.some((n) => n.startsWith('The '))).toBe(true);
    expect(getCountryNamesFromCode('US')).toContain('The United States of America');
    expect(getCountryNamesFromCode('ZZ')).toEqual([]);
  });
});
