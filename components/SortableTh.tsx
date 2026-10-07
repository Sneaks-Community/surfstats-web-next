'use client';

import SortIcon from './SortIcon';
import type { SortDirection } from '@/lib/utils';

interface SortableThProps<F extends string> {
  label: string;
  /** The column this header sorts by. */
  field: F;
  /** The currently active sort column. */
  sortField: F;
  sortDirection: SortDirection;
  onSort: (field: F) => void;
  align?: 'left' | 'right';
  /** Extra classes for the `<th>` (e.g. a fixed width). */
  className?: string;
}

/** Sortable `<th>` whose trigger is a real `<button>`, so keyboard users can reach and activate it
 * (unlike `<th onClick>`). Generic over the field union so each table keeps typed field names. */
export default function SortableTh<F extends string>({
  label,
  field,
  sortField,
  sortDirection,
  onSort,
  align = 'left',
  className = '',
}: SortableThProps<F>) {
  return (
    <th
      scope="col"
      className={`px-2 sm:px-4 py-2 text-xs font-medium text-text-muted uppercase tracking-wider hover:bg-surface-hover/50 transition-colors ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`flex items-center gap-2 w-full cursor-pointer ${align === 'right' ? 'justify-end' : ''}`}
      >
        {label}
        <SortIcon field={field} sortField={sortField} sortDirection={sortDirection} />
      </button>
    </th>
  );
}
