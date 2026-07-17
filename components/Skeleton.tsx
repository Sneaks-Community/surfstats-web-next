import type { ReactNode } from 'react';

/**
 * A single pulsing placeholder block. Pass sizing/rounding via `className`
 * (e.g. `h-4 w-32 rounded`). Kept rounding-free by default so callers can use
 * any `rounded-*` utility without Tailwind border-radius conflicts.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-surface-hover animate-pulse ${className}`} />;
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
