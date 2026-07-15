import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import type { SortDirection } from '@/lib/utils';

interface SortIconProps {
  /** The column this icon belongs to. */
  field: string;
  /** The currently active sort column. */
  sortField: string;
  sortDirection: SortDirection;
}

/**
 * Sort-direction indicator for sortable table/list headers. Shows a neutral
 * up/down arrow for inactive columns and a directional arrow for the active one.
 * Shared by the map and player record tables.
 */
export default function SortIcon({ field, sortField, sortDirection }: SortIconProps) {
  if (sortField !== field) {
    return <ArrowUpDown className="h-4 w-4 text-text-muted opacity-50" />;
  }
  return sortDirection === 'asc' ? (
    <ArrowUp className="h-4 w-4 text-primary-500" />
  ) : (
    <ArrowDown className="h-4 w-4 text-primary-500" />
  );
}
