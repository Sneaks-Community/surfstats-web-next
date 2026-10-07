import { useMemo } from 'react';

interface UsePaginationOptions {
  currentPage: number;
  totalPages: number;
  delta?: number; // pages shown either side of the current one
}

interface UsePaginationResult {
  pageNumbers: Array<number | string>; // '...' marks a gap
  hasNextPage: boolean;
  hasPrevPage: boolean;
  canGoToFirst: boolean;
  canGoToLast: boolean;
}

/** Sliding-window page list: every page up to 7, else first, last and `delta` either side of the
 * current page, with `'...'` for gaps; plus the navigation flags. */
export function usePagination({
  currentPage,
  totalPages,
  delta = 2,
}: UsePaginationOptions): UsePaginationResult {
  return useMemo(() => {
    const pageNumbers: Array<number | string> = [];

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
      for (let i = 1; i <= totalPages; i++) {
        pageNumbers.push(i);
      }
    } else {
      pageNumbers.push(1);

      if (currentPage > delta + 2) {
        pageNumbers.push('...');
      }

      const start = Math.max(2, currentPage - delta);
      const end = Math.min(totalPages - 1, currentPage + delta);

      for (let i = start; i <= end; i++) {
        pageNumbers.push(i);
      }

      if (currentPage < totalPages - delta - 1) {
        pageNumbers.push('...');
      }

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
