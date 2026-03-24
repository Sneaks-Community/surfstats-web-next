'use client';

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

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
  // Calculate which page numbers to show
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const delta = 2; // Number of pages to show on each side of current page

    if (totalPages <= 7) {
      // Show all pages if 7 or fewer
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (currentPage > delta + 2) {
        pages.push('...');
      }

      // Calculate range around current page
      const start = Math.max(2, currentPage - delta);
      const end = Math.min(totalPages - 1, currentPage + delta);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (currentPage < totalPages - delta - 1) {
        pages.push('...');
      }

      // Always show last page
      pages.push(totalPages);
    }

    return pages;
  };

  const pageNumbers = getPageNumbers();

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
          disabled={currentPage === 1}
          className={`p-2 rounded-md border transition-colors ${
            currentPage === 1
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
          disabled={currentPage === 1}
          className={`p-2 rounded-md border transition-colors ${
            currentPage === 1
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
              page === currentPage
                ? 'border-primary-500 bg-primary-500/10 text-primary-500 font-medium'
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
          disabled={currentPage === totalPages}
          className={`p-2 rounded-md border transition-colors ${
            currentPage === totalPages
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
          disabled={currentPage === totalPages}
          className={`p-2 rounded-md border transition-colors ${
            currentPage === totalPages
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