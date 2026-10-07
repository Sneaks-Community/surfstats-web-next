interface ChartSkeletonProps {
  /** Fixed height in px; omit to fill the parent. */
  height?: number;
  /** Title bar width in px. */
  titleWidth?: number;
  /** Min chart-body height in px. */
  minBodyHeight?: number;
}

/** Animated chart-card placeholder for lazy chart bundles and route loading. Props fit each caller:
 * a fixed height in the map chart grid, a min body height for the player and country charts. */
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
