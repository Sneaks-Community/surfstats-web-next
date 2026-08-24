'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from '@/components/Link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Search, User, Map } from 'lucide-react';
import { useMapImagesUrl } from '@/lib/ClientConfigContext';
import { mapImageUrl } from '@/lib/utils';
import { clientError } from '@/lib/client-logger';
import { getErrorMessage, isAbortError } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';

interface PlayerResult {
  steamid: string;
  name: string;
  points: number;
  avatar: string | null;
  avatarmedium: string | null;
}

interface MapResult {
  mapname: string;
  tier: number;
}

interface SearchResponse {
  players: PlayerResult[];
  maps: MapResult[];
}

interface SearchDropdownProps {
  minChars?: number;
  debounceMs?: number;
}

export function SearchDropdown({
  minChars = 3,
  debounceMs = 300
}: SearchDropdownProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse>({ players: [], maps: [] });
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);


  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mapImagesUrl = useMapImagesUrl();

  // Calculate total results for keyboard navigation
  const totalResults = results.players.length + results.maps.length;

  // Search function with AbortController to prevent stale race conditions
  const performSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < minChars) {
      setResults({ players: [], maps: [] });
      setIsOpen(false);
      return;
    }

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();

    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchJson<SearchResponse>(`/api/search?q=${encodeURIComponent(searchQuery)}`, {
        signal: abortControllerRef.current.signal,
      });
      setResults(data);
      setIsOpen(true);
      setSelectedIndex(-1);
    } catch (error) {
      // Ignore abort errors - they're expected when a new search cancels this one
      if (isAbortError(error)) {
        return;
      }
      clientError(`Search error: ${getErrorMessage(error)}`);
      setResults({ players: [], maps: [] });
      // Surface it: a 429/503 must not read as "no matches".
      setError(getErrorMessage(error));
      setIsOpen(true);
    } finally {
      setIsLoading(false);
    }
  }, [minChars]);

  // Debounced search effect with AbortController cleanup
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (query.length < minChars) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Syncing results with query length
      setResults({ players: [], maps: [] });
      setError(null);
      setIsOpen(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      void performSearch(query);
    }, debounceMs);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      // Abort any pending request on cleanup
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [query, minChars, debounceMs, performSearch]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev =>
          prev < totalResults - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => prev > 0 ? prev - 1 : -1);
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          navigateToSelected();
        } else if (query.length >= minChars) {
          // Submit form to search page using Next.js router
          router.push(`/search?q=${encodeURIComponent(query)}`);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSelectedIndex(-1);
        inputRef.current?.blur();
        break;
    }
  };

  // Navigate to selected item using Next.js router
  const navigateToSelected = () => {
    if (selectedIndex < 0) return;

    if (selectedIndex < results.players.length) {
      const player = results.players[selectedIndex];
      router.push(`/players/${player.steamid}`);
    } else {
      const mapIndex = selectedIndex - results.players.length;
      const map = results.maps[mapIndex];
      router.push(`/maps/${map.mapname}`);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  };

  const handleInputFocus = () => {
    if (query.length >= minChars && totalResults > 0) {
      setIsOpen(true);
    }
  };

  const hasResults = results.players.length > 0 || results.maps.length > 0;
  const showDropdown = isOpen && query.length >= minChars && (hasResults || error !== null);

  return (
    <div className="relative" ref={dropdownRef}>
      <form action="/search" method="GET" className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-4 w-4 text-text-placeholder" />
        </div>
        <input
          ref={inputRef}
          type="text"
          name="q"
          value={query}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          aria-label="Search players or maps"
          aria-controls="search-dropdown"
          aria-autocomplete="list"
          className="block w-full pl-10 pr-3 py-2 border border-border rounded-md leading-5 bg-surface text-text placeholder-text-placeholder focus:outline-none focus:bg-background-secondary focus:border-border-focus focus:ring-1 focus:ring-border-focus sm:text-sm transition-colors"
          placeholder="Search players or maps..."
          autoComplete="off"
        />
        {isLoading && (
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
            <div className="w-4 h-4 border-2 border-text-placeholder border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </form>

      {/* Dropdown results */}
      {showDropdown && (
        <div
          id="search-dropdown"
          role="listbox"
          className="absolute z-50 mt-1 w-full bg-surface border border-border rounded-md shadow-lg"
        >
          {error && (
            <div className="px-3 py-2 flex items-center justify-between gap-2">
              <span className="text-text-muted text-sm">Search failed: {error}</span>
              <button
                onClick={() => void performSearch(query)}
                className="text-primary text-sm font-medium hover:underline shrink-0"
              >
                Try again
              </button>
            </div>
          )}

          {/* Players section */}
          {results.players.length > 0 && (
            <div>
              <div className="px-3 py-1 text-xs font-medium text-text-muted uppercase tracking-wider flex items-center gap-1">
                <User className="h-3 w-3" />
                Players
              </div>
              {results.players.map((player, index) => (
                <Link
                  key={player.steamid}
                  href={`/players/${player.steamid}`}
                  onClick={() => setIsOpen(false)}
                  className={`flex items-center gap-2 px-3 py-1.5 hover:bg-surface-hover transition-colors ${
                    selectedIndex === index ? 'bg-surface-hover' : ''
                  }`}
                  role="option"
                  aria-selected={selectedIndex === index}
                >
                  {player.avatarmedium ? (
                    <Image
                      src={player.avatarmedium}
                      alt=""
                      width={24}
                      height={24}
                      className="rounded-full shrink-0"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center shrink-0">
                      <User className="h-3 w-3 text-zinc-400" />
                    </div>
                  )}
                  <span className="text-text text-sm font-medium truncate flex-1">
                    {player.name}
                  </span>
                  <span className="text-text-muted text-xs shrink-0">
                    {player.points.toLocaleString()} pts
                  </span>
                </Link>
              ))}
            </div>
          )}

          {/* Maps section */}
          {results.maps.length > 0 && (
            <div className={results.players.length > 0 ? 'border-t border-border' : ''}>
              <div className="px-3 py-1 text-xs font-medium text-text-muted uppercase tracking-wider flex items-center gap-1">
                <Map className="h-3 w-3" />
                Maps
              </div>
              {results.maps.map((map, index) => {
                const itemIndex = results.players.length + index;
                const imageSrc = mapImageUrl(mapImagesUrl, map.mapname);
                return (
                  <Link
                    key={map.mapname}
                    href={`/maps/${map.mapname}`}
                    onClick={() => setIsOpen(false)}
                    className={`flex items-center gap-2 px-3 py-1.5 hover:bg-surface-hover transition-colors ${
                      selectedIndex === itemIndex ? 'bg-surface-hover' : ''
                    }`}
                    role="option"
                    aria-selected={selectedIndex === itemIndex}
                  >
                    <div className="w-6 h-6 rounded bg-zinc-800 overflow-hidden shrink-0 relative">
                      <Image
                        src={imageSrc}
                        alt=""
                        fill
                        sizes="24px"
                        className="object-cover"
                        unoptimized
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    </div>
                    <span className="text-text text-sm font-medium truncate flex-1">
                      {map.mapname}
                    </span>
                    <span className="text-text-muted text-xs shrink-0">
                      T{map.tier}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
