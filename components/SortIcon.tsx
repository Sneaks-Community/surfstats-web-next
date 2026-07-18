import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import type { SortDirection } from '@/lib/utils';

interface SortIconProps {
  /** The column this icon belongs to. */
  field: string;
  /** The currently active sort column. */
  sortField: string;
  sortDirection: SortDirection;
  /** Tailwind color/opacity classes for the active (sorted) arrow. */
  activeClassName?: string;
  /** Tailwind color/opacity classes for the inactive arrow. */
  inactiveClassName?: string;
}

/**
 * Sort-direction indicator for sortable table/list headers. Shows a neutral
 * up/down arrow for inactive columns and a directional arrow for the active one.
 * Shared by the map and player record tables and the URL-nav header cell; the
 * class props let each caller theme the arrows (e.g. hover-reveal vs. always-on).
 */
export default function SortIcon({
  field,
  sortField,
  sortDirection,
  activeClassName = 'text-primary-500',
  inactiveClassName = 'text-text-muted opacity-50',
}: SortIconProps) {
  if (sortField !== field) {
    return <ArrowUpDown className={`h-4 w-4 ${inactiveClassName}`} aria-label="Click to sort" />;
  }
  return sortDirection === 'asc' ? (
    <ArrowUp className={`h-4 w-4 ${activeClassName}`} aria-label="Sorted ascending" />
  ) : (
    <ArrowDown className={`h-4 w-4 ${activeClassName}`} aria-label="Sorted descending" />
  );
}
