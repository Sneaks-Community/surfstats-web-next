'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  baseUrl: string;
  queryParams?: Record<string, string>;
}

export default function Pagination({
  currentPage,
  totalPages,
  baseUrl,
  queryParams = {},
}: PaginationProps) {
  const [jumpPage, setJumpPage] = useState('');

  // Build URL with all query parameters
  const buildUrl = (page: number) => {
    const params = new URLSearchParams();
    
    // Add all existing query params except page
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    
    // Add page param
    params.set('page', page.toString());
    
    return `${baseUrl}?${params.toString()}`;
  };

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

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const page = parseInt(jumpPage, 10);
    if (page >= 1 && page <= totalPages) {
      window.location.href = buildUrl(page);
    }
  };

  const pageNumbers = getPageNumbers();

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-4">
      {/* Page info */}
      <div className="text-sm text-zinc-400">
        Page <span className="font-medium text-white">{currentPage}</span> of{' '}
        <span className="font-medium text-white">{totalPages.toLocaleString()}</span>
      </div>

      {/* Pagination controls */}
      <div className="flex items-center gap-2 flex-wrap justify-center">
        {/* First page */}
        <Link
          href={buildUrl(1)}
          className={`p-2 rounded-md border transition-colors ${
            currentPage === 1
              ? 'border-zinc-800 text-zinc-600 cursor-not-allowed pointer-events-none'
              : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:border-emerald-500/50'
          }`}
          aria-label="First page"
        >
          <ChevronsLeft className="h-4 w-4" />
        </Link>

        {/* Previous page */}
        <Link
          href={currentPage > 1 ? buildUrl(currentPage - 1) : buildUrl(1)}
          className={`p-2 rounded-md border transition-colors ${
            currentPage === 1
              ? 'border-zinc-800 text-zinc-600 cursor-not-allowed pointer-events-none'
              : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:border-emerald-500/50'
          }`}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>

        {/* Page numbers */}
        <div className="flex items-center gap-1">
          {pageNumbers.map((page, index) => (
            <div key={index}>
              {page === '...' ? (
                <span className="px-2 text-zinc-500">...</span>
              ) : (
                <Link
                  href={buildUrl(page as number)}
                  className={`min-w-[2.5rem] h-9 px-2 rounded-md border text-sm font-medium transition-colors flex items-center justify-center ${
                    currentPage === page
                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                      : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:border-emerald-500/50'
                  }`}
                >
                  {page}
                </Link>
              )}
            </div>
          ))}
        </div>

        {/* Next page */}
        <Link
          href={currentPage < totalPages ? buildUrl(currentPage + 1) : buildUrl(totalPages)}
          className={`p-2 rounded-md border transition-colors ${
            currentPage === totalPages
              ? 'border-zinc-800 text-zinc-600 cursor-not-allowed pointer-events-none'
              : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:border-emerald-500/50'
          }`}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Link>

        {/* Last page */}
        <Link
          href={buildUrl(totalPages)}
          className={`p-2 rounded-md border transition-colors ${
            currentPage === totalPages
              ? 'border-zinc-800 text-zinc-600 cursor-not-allowed pointer-events-none'
              : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:border-emerald-500/50'
          }`}
          aria-label="Last page"
        >
          <ChevronsRight className="h-4 w-4" />
        </Link>

        {/* Jump to page */}
        <form onSubmit={handleJumpSubmit} className="flex items-center gap-2 ml-2">
          <span className="text-sm text-zinc-400 hidden sm:inline">Go to</span>
          <input
            type="number"
            min={1}
            max={totalPages}
            value={jumpPage}
            onChange={(e) => setJumpPage(e.target.value)}
            placeholder="#"
            aria-label={`Jump to page (1-${totalPages})`}
            className="w-16 h-9 px-2 text-center bg-zinc-900 border border-zinc-700 rounded-md text-sm text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
          />
          <button
            type="submit"
            className="h-9 px-3 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-300 hover:bg-zinc-700 hover:border-emerald-500/50 transition-colors"
          >
            Go
          </button>
        </form>
      </div>
    </div>
  );
}
