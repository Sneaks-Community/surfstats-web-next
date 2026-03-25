'use client';

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { usePagination } from '@/hooks/usePagination';

interface ClientPaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export default function ClientPagination({
  currentPage,
  totalPages,
  onPageChange,
}: ClientPaginationProps) {
  const { pageNumbers, hasPrevPage, hasNextPage, canGoToFirst, canGoToLast } = usePagination({
    currentPage,
    totalPages,
  });

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
        <button
          onClick={() => onPageChange(1)}
          disabled={!canGoToFirst}
          className={`p-2 rounded-md border transition-colors ${
            !canGoToFirst
              ? 'border-border text-text-placeholder cursor-not-allowed'
              : 'border-border text-text-muted hover:bg-surface-hover hover:border-primary/50'
          }`}
          aria-label="First page"
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>

        {/* Previous page */}
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={!hasPrevPage}
          className={`p-2 rounded-md border transition-colors ${
            !hasPrevPage
              ? 'border-border text-text-placeholder cursor-not-allowed'
              : 'border-border text-text-muted hover:bg-surface-hover hover:border-primary/50'
          }`}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {/* Page numbers */}
        {pageNumbers.map((page, index) => (
          <button
            key={index}
            onClick={() => typeof page === 'number' && onPageChange(page)}
            disabled={page === '...'}
            className={`min-w-[2.5rem] h-10 px-3 rounded-md border transition-colors ${
              currentPage === page
                ? 'border-primary bg-primary/10 text-primary font-medium'
                : page === '...'
                ? 'border-transparent text-text-muted cursor-default'
                : 'border-border text-text-muted hover:bg-surface-hover hover:border-primary/50'
            }`}
          >
            {page}
          </button>
        ))}

        {/* Next page */}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={!hasNextPage}
          className={`p-2 rounded-md border transition-colors ${
            !hasNextPage
              ? 'border-border text-text-placeholder cursor-not-allowed'
              : 'border-border text-text-muted hover:bg-surface-hover hover:border-primary/50'
          }`}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        {/* Last page */}
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={!canGoToLast}
          className={`p-2 rounded-md border transition-colors ${
            !canGoToLast
              ? 'border-border text-text-placeholder cursor-not-allowed'
              : 'border-border text-text-muted hover:bg-surface-hover hover:border-primary/50'
          }`}
          aria-label="Last page"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
