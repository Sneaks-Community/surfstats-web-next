import type { CSSProperties, ReactNode } from 'react';

/**
 * A single pulsing placeholder block. Pass sizing/rounding via `className`
 * (e.g. `h-4 w-32 rounded`). Kept rounding-free by default so callers can use
 * any `rounded-*` utility without Tailwind border-radius conflicts.
 */
export function Skeleton({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <div className={`bg-surface-hover animate-pulse ${className}`} style={style} />;
}

/**
 * Accessible wrapper for a route `loading.tsx` skeleton. Carries the
 * `role="status"` / `aria-live` / `aria-busy` boilerplate and a screen-reader
 * label so every loading screen announces itself consistently.
 */
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

/**
 * Title + subtitle block opening most routes. Widths are Tailwind classes, not
 * px, so the bars scale with the root font size like the headings they mirror.
 */
export function PageHeaderSkeleton({
  titleWidth = 'w-40',
  subtitleWidth = 'w-64',
  eyebrow = false,
}: {
  titleWidth?: string;
  subtitleWidth?: string;
  /** Small bar above the title, e.g. a back link. */
  eyebrow?: boolean;
}) {
  return (
    <div className="space-y-2">
      {eyebrow && <Skeleton className="h-4 w-28 rounded" />}
      <Skeleton className={`h-8 ${titleWidth} max-w-full rounded-md`} />
      <Skeleton className={`h-4 ${subtitleWidth} max-w-full rounded`} />
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
