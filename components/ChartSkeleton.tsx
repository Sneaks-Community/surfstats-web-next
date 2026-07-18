interface ChartSkeletonProps {
  /** Fixed pixel height. Omit to fill the parent (`h-full`). */
  height?: number;
  /** Width of the title placeholder bar in px. */
  titleWidth?: number;
  /** Minimum height of the chart-body placeholder in px. */
  minBodyHeight?: number;
}

/**
 * Animated placeholder shown while a lazy-loaded chart bundle is fetched.
 * Shared by the player-profile charts (flexible height, 200px min body) and the
 * map chart grid (fixed 250px height); parametrize to match each call site.
 */
export default function ChartSkeleton({
  height,
  titleWidth = 128,
  minBodyHeight,
}: ChartSkeletonProps) {
  return (
    <div
      className="bg-surface border border-border rounded-xl p-4 flex flex-col animate-pulse"
      style={{ height: height ?? '100%' }}
    >
      <div className="h-4 bg-surface-hover rounded mb-4" style={{ width: titleWidth }} />
      <div className="flex-1 bg-surface-hover rounded" style={{ minHeight: minBodyHeight }} />
    </div>
  );
}
