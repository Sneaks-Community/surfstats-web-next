interface ChartEmptyStateProps {
  /** Chart heading, matching the populated card. */
  title: string;
  /** Placeholder text, e.g. "No completions". */
  message: string;
}

/** Full-height card for a chart with no data: the populated card's chrome (surface, border, title)
 * keeps the grid height stable, with a centered muted message in place of the chart. */
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
