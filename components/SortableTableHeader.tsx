import SortLink, { type SortLinkProps } from '@/components/SortLink';

type SortableTableHeaderProps = SortLinkProps;

/**
 * A sortable `<th>` for real `<table>` layouts (e.g. the countries ranking
 * list). Delegates the clickable control to the shared `SortLink`.
 */
export default function SortableTableHeader({
  className = '',
  ...sortLinkProps
}: SortableTableHeaderProps) {
  return (
    <th scope="col" className={`px-4 py-2 text-left text-xs font-medium text-text-muted uppercase tracking-wider ${className}`}>
      <SortLink {...sortLinkProps} />
    </th>
  );
}
