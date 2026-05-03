'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { usePagination } from '@/hooks/usePagination';
import { clientError } from '@/lib/client-logger';

type NavigationMode = 'client' | 'server' | 'none';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  
  // Server-side navigation (Next.js Link)
  baseUrl?: string;
  queryParams?: Record<string, string>;
  
  // Client-side navigation (callback)
  onPageChange?: (page: number) => void;
  
  // Optional: Enable jump-to-page for client-side mode
  allowJumpToPage?: boolean;
}

export default function Pagination({
  currentPage,
  totalPages,
  baseUrl,
  queryParams = {},
  onPageChange,
  allowJumpToPage = false,
}: PaginationProps) {
  const [jumpPage, setJumpPage] = useState('');
  const { pageNumbers, hasPrevPage, hasNextPage, canGoToFirst, canGoToLast } = usePagination({
    currentPage,
    totalPages,
  });

  // Detect navigation mode
  const navigationMode: NavigationMode = useMemo(() => {
    if (onPageChange) return 'client';
    if (baseUrl) return 'server';
    return 'none';
  }, [onPageChange, baseUrl]);

  // Build URL for server-side navigation
  const buildUrl = useCallback((page: number) => {
    const params = new URLSearchParams();
    
    // Add all existing query params except page
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    
    // Add page param
    params.set('page', page.toString());
    
    return `${baseUrl}?${params.toString()}`;
  }, [baseUrl, queryParams]);

  // Handle client-side page change
  const handlePageChange = useCallback((page: number) => {
    if (onPageChange) {
      onPageChange(page);
    }
  }, [onPageChange]);

  const router = useRouter();
  const searchParams = useSearchParams();

  // Handle jump to page
  const handleJumpSubmit = useCallback((e: React.SyntheticEvent) => {
    e.preventDefault();
    const page = parseInt(jumpPage, 10);
    if (page >= 1 && page <= totalPages) {
      if (navigationMode === 'client' && onPageChange) {
        handlePageChange(page);
      } else {
        // Use Next.js router instead of window.location.href for client-side navigation
        const searchStr = searchParams.toString() || '';
        const params = new URLSearchParams(searchStr);
        params.set('page', page.toString());
        router.push(`?${params.toString()}`);
      }
      setJumpPage('');
    }
  }, [jumpPage, totalPages, navigationMode, onPageChange, handlePageChange, router, searchParams]);

  // Render page number button/link
  const renderPageNumber = (page: number | string) => {
    if (page === '...') {
      return (
        <span key="ellipsis" className="px-2 text-text-placeholder">...</span>
      );
    }

    const commonClasses = `min-w-[2.5rem] h-9 px-2 rounded-md border text-sm font-medium transition-colors flex items-center justify-center ${
      currentPage === page
        ? 'bg-primary/20 border-primary text-primary'
        : 'border-border text-text-muted hover:bg-surface-hover hover:border-primary/50'
    }`;

    if (navigationMode === 'client') {
      return (
        <button
          key={page}
          onClick={() => handlePageChange(page as number)}
          className={commonClasses}
        >
          {page}
        </button>
      );
    }

    return (
      <Link
        key={page}
        href={buildUrl(page as number)}
        scroll={false}
        className={commonClasses}
      >
        {page}
      </Link>
    );
  };

  // Render navigation button
  const renderNavButton = (
    onClick: () => void,
    disabled: boolean,
    children: React.ReactNode,
    ariaLabel: string,
    href?: string
  ) => {
    const commonClasses = `p-2 rounded-md border transition-colors ${
      disabled
        ? 'border-border text-text-placeholder cursor-not-allowed pointer-events-none'
        : 'border-border text-text-muted hover:bg-surface-hover hover:border-primary/50'
    }`;

    if (navigationMode === 'client' || !href) {
      return (
        <button
          key={ariaLabel}
          onClick={onClick}
          disabled={disabled}
          className={commonClasses}
          aria-label={ariaLabel}
        >
          {children}
        </button>
      );
    }

    return (
      <Link
        key={ariaLabel}
        href={href}
        scroll={false}
        className={commonClasses}
        aria-label={ariaLabel}
      >
        {children}
      </Link>
    );
  };

  // Validation for development mode
  if (process.env.NODE_ENV === 'development' && navigationMode === 'none') {
    clientError(
      'Pagination requires either baseUrl (for server-side navigation) or onPageChange (for client-side navigation)'
    );
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-4">
      {/* Page info */}
      <div className="text-sm text-text-muted">
        Page <span className="font-medium text-text">{currentPage}</span> of{' '}
        <span className="font-medium text-text">{totalPages.toLocaleString()}</span>
      </div>

      {/* Pagination controls */}
      <div className="flex items-center gap-2 flex-wrap justify-center">
        {/* First page */}
        {renderNavButton(
          () => handlePageChange(1),
          !canGoToFirst,
          <ChevronsLeft className="h-4 w-4" />,
          'First page',
          navigationMode === 'server' ? buildUrl(1) : undefined
        )}

        {/* Previous page */}
        {renderNavButton(
          () => handlePageChange(currentPage - 1),
          !hasPrevPage,
          <ChevronLeft className="h-4 w-4" />,
          'Previous page',
          navigationMode === 'server' && hasPrevPage ? buildUrl(currentPage - 1) : undefined
        )}

        {/* Page numbers */}
        <div className="flex items-center gap-1">
          {pageNumbers.map((page) =>
            typeof page === 'number' ? renderPageNumber(page) : (
              <span key={page} className="px-2 text-text-placeholder">...</span>
            )
          )}
        </div>

        {/* Next page */}
        {renderNavButton(
          () => handlePageChange(currentPage + 1),
          !hasNextPage,
          <ChevronRight className="h-4 w-4" />,
          'Next page',
          navigationMode === 'server' && hasNextPage ? buildUrl(currentPage + 1) : undefined
        )}

        {/* Last page */}
        {renderNavButton(
          () => handlePageChange(totalPages),
          !canGoToLast,
          <ChevronsRight className="h-4 w-4" />,
          'Last page',
          navigationMode === 'server' ? buildUrl(totalPages) : undefined
        )}

        {/* Jump to page (only in server mode or if explicitly allowed) */}
        {(navigationMode === 'server' || allowJumpToPage) && (
          <form onSubmit={handleJumpSubmit} className="flex items-center gap-2 ml-2">
            <span className="text-sm text-text-muted hidden sm:inline">Go to</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={jumpPage}
              onChange={(e) => setJumpPage(e.target.value)}
              placeholder="#"
              aria-label={`Jump to page (1-${totalPages})`}
              className="w-16 h-9 px-2 text-center bg-background-secondary border border-border rounded-md text-sm text-text placeholder-text-placeholder focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus"
            />
            <button
              type="submit"
              className="h-9 px-3 bg-surface border border-border rounded-md text-sm text-text-muted hover:bg-surface-hover hover:border-primary/50 transition-colors"
            >
              Go
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
