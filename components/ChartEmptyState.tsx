interface ChartEmptyStateProps {
  /** Chart heading, shown so the card matches its populated counterpart. */
  title: string;
  /** Muted placeholder message (e.g. "No completions"). */
  message: string;
}

/**
 * Full-height placeholder card shown when a chart has no data.
 *
 * Mirrors the populated chart card chrome (surface + border + title) so the
 * surrounding grid keeps a stable height, with a centered muted message in
 * place of the chart. Extracted from ~12 inline copies across the player
 * profile charts.
 */
export default function ChartEmptyState({ title, message }: ChartEmptyStateProps) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
      <h3 className="text-sm font-semibold text-text mb-2">{title}</h3>
      <div className="flex-1 min-h-[200px] flex items-center justify-center text-text-muted text-sm">
        {message}
      </div>
    </div>
  );
}
