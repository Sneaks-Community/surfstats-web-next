'use client';

import { useEffect, useState } from 'react';
import { useDebounce } from './useDebounce';
import { clientError } from '@/lib/client-logger';
import { getErrorMessage, isAbortError } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';
import { ITEMS_PER_PAGE } from '@/lib/utils';

/** Shorter than this is not a search: nothing is requested and results clear. */
export const MIN_SEARCH_LENGTH = 3;

/** Every record endpoint returns its rows under one of these two keys. */
interface RecordSearchResponse<T> {
  records?: T[];
  stages?: T[];
}

/** A failed request, with the action that re-runs it. */
export interface LoadError {
  message: string;
  retry: () => void;
}

interface RecordSearchOptions<T> {
  initialQuery: string;
  /**
   * Endpoint for a given query. Called during render, so the resulting string is
   * what the request effect depends on: whatever else the URL closes over (map
   * name, selected bonus or stage) re-runs the search by changing it.
   */
  url: (query: string) => string;
  /** Response key holding the rows. */
  rowsKey: keyof RecordSearchResponse<T>;
  /** Prefix for the client-side log line on failure. */
  label: string;
}

export interface RecordSearch<T> {
  query: string;
  /** Settled query, for filtering already-loaded rows against the same text. */
  debouncedQuery: string;
  /** Long enough to be a search, so the tab shows server results, not its own rows. */
  active: boolean;
  isSearching: boolean;
  error: LoadError | null;
  page: number;
  setPage: (page: number) => void;
  /** The current page of results, and how many pages there are. */
  pageRows: T[];
  totalPages: number;
  onChange: (value: string) => void;
  clear: () => void;
}

/**
 * Server-side player search for one record tab: query state, a 400 ms debounce,
 * the request (cancelled when the query or the URL changes), and pagination over
 * the results. The three map tabs and any future one differ only in the URL and
 * the response key.
 */
export function useRecordSearch<T>({
  initialQuery,
  url,
  rowsKey,
  label,
}: RecordSearchOptions<T>): RecordSearch<T> {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<T[]>([]);
  const [settledUrl, setSettledUrl] = useState<string | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [page, setPage] = useState(1);
  const [retryToken, setRetryToken] = useState(0);

  const debouncedQuery = useDebounce(query, 400);
  const requestUrl = debouncedQuery.length >= MIN_SEARCH_LENGTH ? url(debouncedQuery) : null;

  // Derived, not stored: typing "abcd" and deleting back to the loaded "abc"
  // leaves the request URL unchanged, so an eagerly-set flag never cleared.
  const isSearching =
    query.length >= MIN_SEARCH_LENGTH && (query !== debouncedQuery || requestUrl !== settledUrl);

  useEffect(() => {
    if (!requestUrl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Clearing stale results when the query drops below the threshold
      setResults([]);
      return;
    }

    const controller = new AbortController();
    setError(null);
    fetchJson<RecordSearchResponse<T>>(requestUrl, { signal: controller.signal })
      .then((data) => {
        setResults(data[rowsKey] ?? []);
        setPage(1);
        setSettledUrl(requestUrl);
      })
      .catch((err: unknown) => {
        // An abort means a newer request is already in flight; leave the
        // spinner to that one.
        if (!isAbortError(err)) {
          clientError(`[${label}] Search failed: ${getErrorMessage(err)}`);
          setResults([]);
          setError({
            message: getErrorMessage(err),
            // Clearing settledUrl puts the spinner back for the retry.
            retry: () => {
              setSettledUrl(null);
              setRetryToken((t) => t + 1);
            },
          });
          setSettledUrl(requestUrl);
        }
      });
    return () => controller.abort();
  }, [requestUrl, rowsKey, label, retryToken]);

  const onChange = (value: string) => {
    setQuery(value);
    setPage(1);
    if (value.length < MIN_SEARCH_LENGTH) setResults([]);
  };

  const clear = () => {
    setQuery('');
    setPage(1);
    setResults([]);
  };

  return {
    query,
    debouncedQuery,
    active: query.length >= MIN_SEARCH_LENGTH,
    isSearching,
    error,
    page,
    setPage,
    pageRows: results.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE),
    totalPages: Math.ceil(results.length / ITEMS_PER_PAGE),
    onChange,
    clear,
  };
}
