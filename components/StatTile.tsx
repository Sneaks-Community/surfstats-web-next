import type { LucideIcon } from 'lucide-react';

type Accent = 'primary' | 'secondary';

interface StatTileProps {
  icon: LucideIcon;
  value: number | string;
  label: string;
  /** Icon chip hue. */
  accent?: Accent;
}

// Theme tokens, never palette colors, so tiles follow the env theme and light/dark mode.
const ACCENT_CLASSES: Record<Accent, string> = {
  primary: 'bg-primary/10 text-primary',
  secondary: 'bg-secondary/10 text-secondary',
};

/** One headline metric: icon chip, large value and caption, in the app's card chrome. */
export default function StatTile({ icon: Icon, value, label, accent = 'primary' }: StatTileProps) {
  const display = typeof value === 'number' ? value.toLocaleString() : value;

  return (
    <div className="bg-surface border border-border rounded-xl p-4 xl:p-3 flex items-center gap-4 xl:gap-3">
      <div className={`flex items-center justify-center h-11 w-11 xl:h-9 xl:w-9 rounded-lg shrink-0 ${ACCENT_CLASSES[accent]}`}>
        <Icon className="h-6 w-6 xl:h-5 xl:w-5" />
      </div>
      <div className="min-w-0">
        {/* Smaller in the dense 6-up xl layout so totals fit; truncate + title catch wider ones. */}
        <div className="text-2xl xl:text-base font-bold text-text leading-tight tabular-nums truncate" title={display}>{display}</div>
        <div className="text-xs xl:text-[10px] text-text-muted uppercase tracking-wider xl:tracking-normal font-semibold mt-0.5 whitespace-nowrap">{label}</div>
      </div>
    </div>
  );
}
