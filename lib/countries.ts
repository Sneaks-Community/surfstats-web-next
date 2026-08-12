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
  // GeoIP variants i18n-iso-countries doesn't resolve even after the leading
  // "The " is stripped (see getCountryCodeFromName). Keyed by the lowercased
  // name exactly as stored in ck_playerrank.country.
  moldova: 'MD',
  'the republic of moldova': 'MD',
  'republic of moldova': 'MD',
  'the republic of lithuania': 'LT',
  macedonia: 'MK',
  'hashemite kingdom of jordan': 'JO',
  'the iran, islamic republic of': 'IR',
  'palestinian territory': 'PS',
  syria: 'SY',
  'libyan arab jamahiriya': 'LY',
  'sint maarten': 'SX',
  'st kitts and nevis': 'KN',
  'the u.s. virgin islands': 'VI',
  'france, metropolitan': 'FR',
  'cabo verde': 'CV',
  'åland': 'AX',
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
  // hasOwn, not a truthiness test: a DB value of `constructor` or `toString`
  // would otherwise return a Function off the prototype chain.
  if (Object.hasOwn(NAME_OVERRIDES, normalized)) return NAME_OVERRIDES[normalized];

  // Look up the normalized form, not the raw one: the dataset is
  // case-insensitive but not whitespace-tolerant, so " Germany " missed.
  const direct = countries.getAlpha2Code(normalized, 'en');
  if (direct) return direct;

  // GeoIP uses the official ISO short name with a leading article for some
  // countries ("The United States", "The United Kingdom", "The Russian
  // Federation"). i18n-iso-countries doesn't resolve those forms, which silently
  // dropped the single largest country from every country view — strip a leading
  // "The " and retry (through the overrides too).
  const stripped = normalized.replace(/^the\s+/, '');
  if (stripped !== normalized) {
    if (Object.hasOwn(NAME_OVERRIDES, stripped)) return NAME_OVERRIDES[stripped];
    const retry = countries.getAlpha2Code(stripped, 'en');
    if (retry) return retry;
  }

  return UNKNOWN_COUNTRY_CODE;
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
 * Convert an ISO 3166-1 alpha-2 code to its zero-padded numeric code
 * (e.g. "US" -> "840", "AL" -> "008"), or undefined if it can't be resolved.
 *
 * Used to match players' country codes to world-map (TopoJSON) features, whose
 * feature ids are the same zero-padded ISO numeric strings.
 */
export function getNumericCodeFromAlpha2(code: string): string | undefined {
  if (!code || code === UNKNOWN_COUNTRY_CODE) return undefined;
  return countries.alpha2ToNumeric(code.toUpperCase()) || undefined;
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

  // GeoIP stores some countries with a leading article ("The United States",
  // "The United Kingdom"). Mirror each name with a "The " prefix so country
  // detail queries match those rows too (the forward mapping in
  // getCountryCodeFromName already strips the article).
  for (const name of [...names]) {
    if (!/^the\s+/i.test(name)) names.add(`The ${name}`);
  }

  return [...names];
}
