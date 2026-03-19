'use client';

import * as React from 'react';
import { hasFlag } from 'country-flag-icons';
import * as Flags from 'country-flag-icons/react/3x2';
import { countryNameToCode } from '@/lib/countries';

interface CountryBadgeProps {
  countryCode: string | null | undefined;
  showName?: boolean;
  className?: string;
}

function getCountryCode(input: string | null | undefined): string | null {
  if (!input) return null;
  
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  
  // If it's already a 2-letter code, return it uppercase
  if (trimmed.length === 2) {
    return trimmed.toUpperCase();
  }
  
  // Try to match by lowercase name
  const lowerName = trimmed.toLowerCase();
  if (countryNameToCode[lowerName]) {
    return countryNameToCode[lowerName];
  }
  
  // Try partial matching for names like "The United States" or "United States of America"
  for (const [name, code] of Object.entries(countryNameToCode)) {
    if (lowerName.includes(name) || name.includes(lowerName)) {
      return code;
    }
  }
  
  return null;
}

export default function CountryBadge({ 
  countryCode, 
  showName = true,
  className = '' 
}: CountryBadgeProps) {
  // Convert country name to ISO code if needed
  const isoCode = getCountryCode(countryCode);
  
  // Handle null, undefined, or empty country codes
  if (!isoCode) {
    return (
      <span className={`inline-flex items-center gap-2 text-zinc-500 ${className}`} title={countryCode || 'Unknown'}>
        <span className="text-xs">N/A</span>
      </span>
    );
  }

  // Check if the flag exists
  if (!hasFlag(isoCode)) {
    return (
      <span className={`inline-flex items-center gap-2 text-zinc-500 ${className}`} title={countryCode || 'Unknown'}>
        <span className="text-xs">{isoCode}</span>
      </span>
    );
  }

  // Get the flag component dynamically
  const FlagComponent = (Flags as Record<string, React.FC<React.SVGProps<SVGSVGElement>>>)[isoCode];

  if (!FlagComponent) {
    return (
      <span className={`inline-flex items-center gap-2 text-zinc-500 ${className}`} title={countryCode || 'Unknown'}>
        <span className="text-xs">{isoCode}</span>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className}`} title={countryCode || isoCode}>
      <span className="w-5 h-4 flex-shrink-0">
        <FlagComponent
          className="w-full h-full rounded-sm"
          aria-label={`Flag of ${isoCode}`}
        />
      </span>
      {showName && (
        <span className="text-sm text-zinc-300">{isoCode}</span>
      )}
    </span>
  );
}