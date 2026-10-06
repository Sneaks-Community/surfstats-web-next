import countries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';

// ck_playerrank.country holds GeoIP English names, which this dataset's English name set matches.
countries.registerLocale(enLocale);

/** Sentinel for an unresolvable name, not a real ISO code; callers skip it. */
export const UNKNOWN_COUNTRY_CODE = 'UN';

// Game/GeoIP spellings the dataset misses (also after stripping "The "), keyed by the lowercased
// ck_playerrank.country value, mapped to ISO alpha-2.
const NAME_OVERRIDES: Record<string, string> = {
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  korea: 'KR',
  holland: 'NL',
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
 * ISO alpha-2 code for a name (case- and whitespace-insensitive, overrides first), or "UN".
 * Never guessed from the name's letters: fake codes collide and give country pages no players.
 */
export function getCountryCodeFromName(name: string): string {
  const normalized = name.toLowerCase().trim();
  if (!normalized) return UNKNOWN_COUNTRY_CODE;
  // hasOwn, not truthiness: `constructor` or `toString` would hit the prototype chain.
  if (Object.hasOwn(NAME_OVERRIDES, normalized)) return NAME_OVERRIDES[normalized];

  // Look up the normalized form: the dataset is case-insensitive but not whitespace-tolerant.
  const direct = countries.getAlpha2Code(normalized, 'en');
  if (direct) return direct;

  // GeoIP prefixes some names with an article ("The United States", "The Russian Federation"),
  // which the dataset misses; strip it and retry, overrides included.
  const stripped = normalized.replace(/^the\s+/, '');
  if (stripped !== normalized) {
    if (Object.hasOwn(NAME_OVERRIDES, stripped)) return NAME_OVERRIDES[stripped];
    const retry = countries.getAlpha2Code(stripped, 'en');
    if (retry) return retry;
  }

  return UNKNOWN_COUNTRY_CODE;
}

export function getPrimaryCountryName(code: string): string | undefined {
  return countries.getName(code.toUpperCase(), 'en') || undefined;
}

export function isValidCountryCode(code: string): boolean {
  return countries.isValid(code);
}

/** Zero-padded ISO numeric code ("AL" -> "008"), matching the world-map TopoJSON feature ids. */
export function getNumericCodeFromAlpha2(code: string): string | undefined {
  if (!code || code === UNKNOWN_COUNTRY_CODE) return undefined;
  return countries.alpha2ToNumeric(code.toUpperCase()) || undefined;
}

/**
 * Every DB spelling of a code (dataset aliases, overrides, "The " forms), for a
 * `WHERE country = ? OR ...` clause; the collation ignores case.
 */
export function getCountryNamesFromCode(code: string): string[] {
  const upper = code.toUpperCase();
  const names = new Set<string>();

  // undefined for an unknown code.
  const isoNames = countries.getName(upper, 'en', { select: 'all' });
  if (Array.isArray(isoNames)) {
    for (const name of isoNames) names.add(name);
  }

  for (const [alias, aliasCode] of Object.entries(NAME_OVERRIDES)) {
    if (aliasCode === upper) names.add(alias);
  }

  // Add "The " forms so detail queries match GeoIP rows like "The United States"
  // (getCountryCodeFromName strips the article going the other way).
  for (const name of [...names]) {
    if (!/^the\s+/i.test(name)) names.add(`The ${name}`);
  }

  return [...names];
}
