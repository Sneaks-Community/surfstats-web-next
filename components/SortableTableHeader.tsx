'use client';

import Link from 'next/link';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';

interface SortableTableHeaderProps {
  column: string;
  label: string;
  currentSort: string;
  currentOrder: 'asc' | 'desc';
  baseUrl: string;
  queryParams?: Record<string, string>;
  defaultOrder?: 'asc' | 'desc';
  className?: string;
}

export default function SortableTableHeader({
  column,
  label,
  currentSort,
  currentOrder,
  baseUrl,
  queryParams = {},
  defaultOrder = 'desc',
  className = '',
}: SortableTableHeaderProps) {
  const isActive = currentSort === column;
  
  // Determine the order for this column when clicked
  // If currently active, toggle the order
  // If not active, use the default order for this column
  const nextOrder = isActive 
    ? (currentOrder === 'asc' ? 'desc' : 'asc')
    : defaultOrder;
  
  // Build URL with all query parameters
  const buildUrl = () => {
    const params = new URLSearchParams();
    
    // Add all existing query params except sort and order
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value && key !== 'sort' && key !== 'order') {
        params.set(key, value);
      }
    });
    
    // Add sort and order
    params.set('sort', column);
    params.set('order', nextOrder);
    
    // Add page=1 when changing sort to reset pagination
    if (!params.has('page')) {
      params.set('page', '1');
    }
    
    return `${baseUrl}?${params.toString()}`;
  };
  
  return (
    <th scope="col" className={`px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider ${className}`}>
      <Link
        href={buildUrl()}
        className="inline-flex items-center gap-1 hover:text-text transition-colors group"
      >
        <span>{label}</span>
        <span className="inline-flex items-center">
          {isActive ? (
            currentOrder === 'asc' ? (
              <ArrowUp className="h-4 w-4" aria-label="Sorted ascending" />
            ) : (
              <ArrowDown className="h-4 w-4" aria-label="Sorted descending" />
            )
          ) : (
            <ArrowUpDown className="h-4 w-4 opacity-0 group-hover:opacity-50 transition-opacity" aria-label="Click to sort" />
          )}
        </span>
      </Link>
    </th>
  );
}