'use client';

import { Search, X } from 'lucide-react';

interface RecordSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  placeholder: string;
  /** Accessible label; defaults to the placeholder. */
  ariaLabel?: string;
  /**
   * Visual style:
   * - `compact`: inline, capped-width filter (map records tabs)
   * - `full`: full-width search bar (player records tabs)
   */
  variant?: 'compact' | 'full';
}

/**
 * Search input with a leading magnifier and a trailing clear button, shared by
 * the map and player record tables. Two visual variants preserve each table's
 * original appearance.
 */
export default function RecordSearchInput({
  value,
  onChange,
  onClear,
  placeholder,
  ariaLabel,
  variant = 'compact',
}: RecordSearchInputProps) {
  if (variant === 'full') {
    return (
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel ?? placeholder}
          className="w-full pl-10 pr-10 py-2 bg-surface-hover border border-border rounded-lg text-text placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
        {value && (
          <button
            onClick={onClear}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-surface-active transition-colors"
          >
            <X className="h-4 w-4 text-text-muted" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex-1 max-w-xs">
      <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
        <Search className="h-3.5 w-3.5 text-text-placeholder" />
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className="block w-full pl-10 pr-8 py-2 border border-border rounded-md leading-5 bg-background-secondary text-text placeholder-text-placeholder focus:outline-none focus:bg-surface focus:border-border-focus focus:ring-1 focus:ring-border-focus sm:text-sm transition-colors"
      />
      {value && (
        <button
          onClick={onClear}
          aria-label="Clear search"
          className="absolute inset-y-0 right-0 pr-3 flex items-center text-text-placeholder hover:text-text"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
