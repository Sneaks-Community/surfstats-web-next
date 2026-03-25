/**
 * Pagination hook for calculating page numbers to display
 * 
 * Implements sliding window pagination with ellipsis for large page counts.
 * Delta controls how many pages to show on each side of the current page.
 * 
 * @example
 * ```tsx
 * const { pageNumbers, hasNextPage, hasPrevPage } = usePagination({
 *   currentPage: 5,
 *   totalPages: 100,
 *   delta: 2,
 * });
 * ```
 */

import { useMemo } from 'react';

interface UsePaginationOptions {
  currentPage: number;
  totalPages: number;
  delta?: number; // Number of pages to show on each side of current page (default: 2)
}

interface UsePaginationResult {
  pageNumbers: (number | string)[]; // Array of page numbers with '...' for gaps
  hasNextPage: boolean;
  hasPrevPage: boolean;
  canGoToFirst: boolean;
  canGoToLast: boolean;
}

/**
 * Hook to calculate pagination state
 * 
 * Returns an array of page numbers to display, with ellipsis placeholders
 * for gaps when there are many pages. Also provides navigation state flags.
 */
export function usePagination({
  currentPage,
  totalPages,
  delta = 2,
}: UsePaginationOptions): UsePaginationResult {
  return useMemo(() => {
    const pageNumbers: (number | string)[] = [];

    if (totalPages <= 0) {
      return {
        pageNumbers: [],
        hasNextPage: false,
        hasPrevPage: false,
        canGoToFirst: false,
        canGoToLast: false,
      };
    }

    if (totalPages <= 7) {
      // Show all pages if 7 or fewer
      for (let i = 1; i <= totalPages; i++) {
        pageNumbers.push(i);
      }
    } else {
      // Always show first page
      pageNumbers.push(1);

      if (currentPage > delta + 2) {
        pageNumbers.push('...');
      }

      // Calculate range around current page
      const start = Math.max(2, currentPage - delta);
      const end = Math.min(totalPages - 1, currentPage + delta);

      for (let i = start; i <= end; i++) {
        pageNumbers.push(i);
      }

      if (currentPage < totalPages - delta - 1) {
        pageNumbers.push('...');
      }

      // Always show last page
      pageNumbers.push(totalPages);
    }

    return {
      pageNumbers,
      hasNextPage: currentPage < totalPages,
      hasPrevPage: currentPage > 1,
      canGoToFirst: currentPage > 1,
      canGoToLast: currentPage < totalPages,
    };
  }, [currentPage, totalPages, delta]);
}
