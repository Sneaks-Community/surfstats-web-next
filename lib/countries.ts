/**
 * Country name <-> ISO 3166-1 alpha-2 helpers.
 *
 * Backed by the maintained `i18n-iso-countries` dataset (complete ISO 3166
 * coverage in English, including common aliases) rather than a hand-kept map.
 * The database stores GeoIP-derived English country names, so the library's
 * name set matches the values we see in `ck_playerrank.country`.
 *
 * A tiny override table handles game/GeoIP spellings the library does not
 * recognise on its own (e.g. the UK constituent countries, bare "Korea").
 */
import countries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';

countries.registerLocale(enLocale);

/**
 * Sentinel code for a country name we can't resolve. Not a real ISO code;
 * callers treat it as "skip / unknown".
 */
export const UNKNOWN_COUNTRY_CODE = 'UN';

/**
 * Aliases not covered by i18n-iso-countries. Keys are lowercased names,
 * values are ISO 3166-1 alpha-2 codes.
 */
const NAME_OVERRIDES: Record<string, string> = {
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  korea: 'KR',
  holland: 'NL',
};

/**
 * Convert a country name to its ISO 3166-1 alpha-2 code.
 * Normalizes the input (lowercase, trim) and consults the override table
 * before the ISO dataset.
 *
 * Returns "UN" (unknown) for any name that can't be resolved. We deliberately
 * do NOT fabricate a code from the name's first two letters: that produced
 * invalid codes that could collide and created ranking rows whose country
 * pages resolved to zero players.
 *
 * @example
 * getCountryCodeFromName("United States") // "US"
 * getCountryCodeFromName("thailand")      // "TH"
 * getCountryCodeFromName("Narnia")        // "UN"
 */
export function getCountryCodeFromName(name: string): string {
  const normalized = name.toLowerCase().trim();
  if (!normalized) return UNKNOWN_COUNTRY_CODE;
  if (NAME_OVERRIDES[normalized]) return NAME_OVERRIDES[normalized];
  return countries.getAlpha2Code(name, 'en') || UNKNOWN_COUNTRY_CODE;
}

/**
 * Get the primary (canonical) English country name for a given ISO code,
 * or undefined if the code is not valid.
 */
export function getPrimaryCountryName(code: string): string | undefined {
  return countries.getName(code.toUpperCase(), 'en') || undefined;
}

/**
 * Check if a country code is a valid ISO 3166-1 code.
 */
export function isValidCountryCode(code: string): boolean {
  return countries.isValid(code);
}

/**
 * Get all name variations that map to a given ISO code.
 *
 * Used to build the `WHERE country = ? OR ...` clause that matches the
 * various spellings stored in the database (matching is case-insensitive at
 * the DB collation level). Combines the ISO dataset's aliases with our
 * override aliases for that code.
 */
export function getCountryNamesFromCode(code: string): string[] {
  const upper = code.toUpperCase();
  const names = new Set<string>();

  // Returns string[] for a valid code, or undefined for an unknown one.
  const isoNames = countries.getName(upper, 'en', { select: 'all' });
  if (Array.isArray(isoNames)) {
    for (const name of isoNames) names.add(name);
  }

  for (const [alias, aliasCode] of Object.entries(NAME_OVERRIDES)) {
    if (aliasCode === upper) names.add(alias);
  }

  return [...names];
}
