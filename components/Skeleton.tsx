import type { CSSProperties, ReactNode } from 'react';

/** Pulsing placeholder block, sized and rounded via `className` (e.g. `h-4 w-32 rounded`). No
 * default rounding, so a caller's `rounded-*` never conflicts with one. */
export function Skeleton({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <div className={`bg-surface-hover animate-pulse ${className}`} style={style} />;
}

/** Wrapper for a route `loading.tsx` skeleton: `role="status"`, `aria-live`, `aria-busy` and an
 * sr-only label, so every loading screen announces itself the same way. */
export function SkeletonScreen({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`skeleton-reveal ${className}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Card chrome for a skeleton panel, mirroring the real surface + PanelHeader pair. */
export function PanelSkeleton({
  headerWidth,
  className = '',
  children,
}: {
  /** Title-bar width class, e.g. `w-40`. Omit for a card with no header bar. */
  headerWidth?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`bg-surface border border-border rounded-xl overflow-hidden ${className}`.trim()}>
      {headerWidth && (
        <div className="px-4 py-3 border-b border-border bg-surface/50">
          <Skeleton className={`h-5 ${headerWidth} rounded`} />
        </div>
      )}
      {children}
    </div>
  );
}
