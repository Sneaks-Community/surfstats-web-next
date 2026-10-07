import * as React from 'react';
import { hasFlag } from 'country-flag-icons';
import * as Flags from 'country-flag-icons/react/3x2';
import { getCountryCodeFromName, getPrimaryCountryName, UNKNOWN_COUNTRY_CODE } from '@/lib/countries';

interface CountryBadgeProps {
  countryCode: string | null | undefined;
  showName?: boolean;
  className?: string;
}

/** ISO code from a 2-letter code or a country name (ISO dataset, aliases too); null if unmapped. */
function getCountryCode(input: string | null | undefined): string | null {
  if (!input) return null;
  
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  
  if (trimmed.length === 2) {
    return trimmed.toUpperCase();
  }

  const code = getCountryCodeFromName(trimmed);
  return code === UNKNOWN_COUNTRY_CODE ? null : code;
}

/** Full country name for the code, else `originalName`, else the code. */
function getCountryDisplayName(isoCode: string, originalName?: string): string {
  const fullName = getPrimaryCountryName(isoCode);
  if (fullName) {
    return fullName;
  }
  if (originalName) {
    return originalName;
  }
  return isoCode;
}

export default function CountryBadge({
  countryCode,
  showName = true,
  className = ''
}: CountryBadgeProps) {
  const isoCode = getCountryCode(countryCode);
  
  if (!isoCode) {
    return (
      <span className={`inline-flex items-center gap-2 text-text-placeholder ${className}`} title={countryCode || 'Unknown'}>
        <span className="text-xs">N/A</span>
      </span>
    );
  }

  if (!hasFlag(isoCode)) {
    const displayName = getCountryDisplayName(isoCode, countryCode || undefined);
    return (
      <span className={`inline-flex items-center gap-2 text-text-placeholder ${className}`} title={countryCode || 'Unknown'}>
        <span className="text-xs">{displayName}</span>
      </span>
    );
  }

  const FlagsRecord = Flags as Record<string, React.FC<React.SVGProps<SVGSVGElement>>> | undefined;
  const FlagComponent = FlagsRecord?.[isoCode];

  if (FlagComponent == null) {
    const displayName = getCountryDisplayName(isoCode, countryCode || undefined);
    return (
      <span className={`inline-flex items-center gap-2 text-text-placeholder ${className}`} title={countryCode || 'Unknown'}>
        <span className="text-xs">{displayName}</span>
      </span>
    );
  }

  const displayName = getCountryDisplayName(isoCode, countryCode || undefined);

  return (
    <span className={`inline-flex items-center gap-2 ${className}`} title={countryCode || isoCode}>
      <span className="w-5 h-4 flex-shrink-0">
        <FlagComponent
          className="w-full h-full rounded-sm"
          aria-label={`Flag of ${displayName}`}
        />
      </span>
      {showName && (
        <span className="text-sm text-text-muted">{displayName}</span>
      )}
    </span>
  );
}