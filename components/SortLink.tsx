'use client';

import Link from '@/components/Link';
import SortIcon from '@/components/SortIcon';
import { useNavigationPending } from '@/components/NavigationPending';

export interface SortLinkProps {
  column: string;
  label: string;
  currentSort: string;
  currentOrder: 'asc' | 'desc';
  baseUrl: string;
  queryParams?: Record<string, string>;
  defaultOrder?: 'asc' | 'desc';
  /** Extra classes for the link (e.g. justify-end for right-aligned columns). */
  className?: string;
}

/**
 * The clickable sort control shared by the table-header (`SortableTableHeader`,
 * which wraps this in a `<th>`) and the div-based player list header. Owns the
 * next-order toggle, URL building, and the instant pending-skeleton navigation.
 */
export default function SortLink({
  column,
  label,
  currentSort,
  currentOrder,
  baseUrl,
  queryParams = {},
  defaultOrder = 'desc',
  className = '',
}: SortLinkProps) {
  const isActive = currentSort === column;
  const nav = useNavigationPending();

  // If currently active, toggle the order; otherwise use this column's default.
  const nextOrder = isActive
    ? currentOrder === 'asc' ? 'desc' : 'asc'
    : defaultOrder;

  const buildUrl = () => {
    const params = new URLSearchParams();

    // Carry existing params except sort/order (which we set below).
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value && key !== 'sort' && key !== 'order') {
        params.set(key, value);
      }
    });

    params.set('sort', column);
    params.set('order', nextOrder);

    // Reset pagination when the sort changes.
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
    <Link
      href={href}
      onClick={handleClick}
      className={`inline-flex items-center gap-1 hover:text-text transition-colors group ${className}`}
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
  );
}
