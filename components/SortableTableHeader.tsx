'use client';

import Link from 'next/link';
import SortIcon from '@/components/SortIcon';
import { useNavigationPending } from '@/components/NavigationPending';

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
  const nav = useNavigationPending();

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

  const href = buildUrl();

  // Route plain left-clicks through the transition-backed provider so the
  // pending skeleton shows immediately; modified clicks and the no-provider
  // case fall through to the <Link>.
  const handleClick = (e: React.MouseEvent) => {
    if (!nav) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    nav.navigate(href);
  };

  return (
    <th scope="col" className={`px-4 py-2 text-left text-xs font-medium text-text-muted uppercase tracking-wider ${className}`}>
      <Link
        href={href}
        onClick={handleClick}
        className="inline-flex items-center gap-1 hover:text-text transition-colors group"
      >
        <span>{label}</span>
        <span className="inline-flex items-center">
          <SortIcon
            field={column}
            sortField={currentSort}
            sortDirection={currentOrder}
            activeClassName=""
            inactiveClassName="opacity-0 group-hover:opacity-50 transition-opacity"
          />
        </span>
      </Link>
    </th>
  );
}