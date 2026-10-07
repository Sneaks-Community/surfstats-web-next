'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import Link from '@/components/Link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { usePagination } from '@/hooks/usePagination';
import { useNavigationPending } from '@/components/NavigationPending';
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
}

export default function Pagination({
  currentPage,
  totalPages,
  baseUrl,
  queryParams = {},
  onPageChange,
}: PaginationProps) {
  const [jumpPage, setJumpPage] = useState('');
  const { pageNumbers, hasPrevPage, hasNextPage, canGoToFirst, canGoToLast } = usePagination({
    currentPage,
    totalPages,
  });

  const navigationMode: NavigationMode = useMemo(() => {
    if (onPageChange) return 'client';
    if (baseUrl) return 'server';
    return 'none';
  }, [onPageChange, baseUrl]);

  const buildUrl = useCallback((page: number) => {
    const params = new URLSearchParams();
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    params.set('page', page.toString());
    
    return `${baseUrl}?${params.toString()}`;
  }, [baseUrl, queryParams]);

  const handlePageChange = useCallback((page: number) => {
    if (onPageChange) {
      onPageChange(page);
    }
  }, [onPageChange]);

  const router = useRouter();
  const searchParams = useSearchParams();
  const nav = useNavigationPending();

  // Plain left-clicks on server-mode links go through the provider so the skeleton shows at once;
  // modified clicks (new tab) and the no-provider case fall through to the <Link>.
  const handleNavClick = useCallback(
    (e: React.MouseEvent, href: string) => {
      if (!nav) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      nav.navigate(href);
    },
    [nav]
  );

  const handleJumpSubmit = useCallback((e: React.SyntheticEvent) => {
    e.preventDefault();
    const page = parseInt(jumpPage, 10);
    if (page >= 1 && page <= totalPages) {
      if (navigationMode === 'client' && onPageChange) {
        handlePageChange(page);
      } else {
        const searchStr = searchParams.toString() || '';
        const params = new URLSearchParams(searchStr);
        params.set('page', page.toString());
        const url = `?${params.toString()}`;
        // Client-side, no full reload; via the provider when present so the skeleton shows at once.
        if (nav) {
          nav.navigate(url);
        } else {
          router.push(url);
        }
      }
      setJumpPage('');
    }
  }, [jumpPage, totalPages, navigationMode, onPageChange, handlePageChange, router, searchParams, nav]);

  const renderPageNumber = (page: number) => {
    const commonClasses = `min-w-[2.5rem] h-9 px-2 rounded-md border text-sm font-medium transition-colors flex items-center justify-center ${
      currentPage === page
        ? 'bg-primary/20 border-primary text-primary'
        : 'border-border text-text-muted hover:bg-surface-hover hover:border-primary/50'
    }`;

    if (navigationMode === 'client') {
      return (
        <button
          key={page}
          onClick={() => handlePageChange(page)}
          className={commonClasses}
        >
          {page}
        </button>
      );
    }

    const href = buildUrl(page);
    return (
      <Link
        key={page}
        href={href}
        scroll={false}
        onClick={(e) => handleNavClick(e, href)}
        className={commonClasses}
      >
        {page}
      </Link>
    );
  };

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

    // A disabled control must be a real <button disabled>: an anchor stays
    // tabbable and Enter still navigates, whatever pointer-events says.
    if (navigationMode === 'client' || !href || disabled) {
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
        onClick={(e) => handleNavClick(e, href)}
        className={commonClasses}
        aria-label={ariaLabel}
      >
        {children}
      </Link>
    );
  };

  // Dev-only misuse check, in an effect so render stays pure.
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && navigationMode === 'none') {
      clientError(
        'Pagination requires either baseUrl (for server-side navigation) or onPageChange (for client-side navigation)'
      );
    }
  }, [navigationMode]);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-4">
      <div className="text-sm text-text-muted">
        Page <span className="font-medium text-text">{currentPage}</span> of{' '}
        <span className="font-medium text-text">{totalPages.toLocaleString()}</span>
      </div>

      {/* Pagination controls */}
      <div className="flex items-center gap-2 flex-wrap justify-center">
        {renderNavButton(
          () => handlePageChange(1),
          !canGoToFirst,
          <ChevronsLeft className="h-4 w-4" />,
          'First page',
          navigationMode === 'server' ? buildUrl(1) : undefined
        )}

        {renderNavButton(
          () => handlePageChange(currentPage - 1),
          !hasPrevPage,
          <ChevronLeft className="h-4 w-4" />,
          'Previous page',
          navigationMode === 'server' && hasPrevPage ? buildUrl(currentPage - 1) : undefined
        )}

        <div className="flex items-center gap-1">
          {pageNumbers.map((page, idx) =>
            typeof page === 'number' ? renderPageNumber(page) : (
              <span key={`ellipsis-${idx}`} className="px-2 text-text-placeholder">...</span>
            )
          )}
        </div>

        {renderNavButton(
          () => handlePageChange(currentPage + 1),
          !hasNextPage,
          <ChevronRight className="h-4 w-4" />,
          'Next page',
          navigationMode === 'server' && hasNextPage ? buildUrl(currentPage + 1) : undefined
        )}

        {renderNavButton(
          () => handlePageChange(totalPages),
          !canGoToLast,
          <ChevronsRight className="h-4 w-4" />,
          'Last page',
          navigationMode === 'server' ? buildUrl(totalPages) : undefined
        )}

        {navigationMode === 'server' && (
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
