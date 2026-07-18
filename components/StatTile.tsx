import type { LucideIcon } from 'lucide-react';

type Accent = 'primary' | 'secondary';

interface StatTileProps {
  icon: LucideIcon;
  value: number | string;
  label: string;
  /** Accent hue for the icon chip. Uses theme tokens so it follows the configured theme. */
  accent?: Accent;
}

// Theme-token accents (never hardcoded palette colors) so tiles follow the
// env-configured theme and light/dark modes.
const ACCENT_CLASSES: Record<Accent, string> = {
  primary: 'bg-primary/10 text-primary',
  secondary: 'bg-secondary/10 text-secondary',
};

/**
 * A single headline metric: an icon chip + a large value + a caption.
 * Matches the app's card chrome (bg-surface / border-border / rounded-xl).
 */
export default function StatTile({ icon: Icon, value, label, accent = 'primary' }: StatTileProps) {
  const display = typeof value === 'number' ? value.toLocaleString() : value;

  return (
    <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-4">
      <div className={`flex items-center justify-center h-11 w-11 rounded-lg shrink-0 ${ACCENT_CLASSES[accent]}`}>
        <Icon className="h-6 w-6" />
      </div>
      <div className="min-w-0">
        {/* Proportional figures (no tabular-nums) for a large standalone value. */}
        <div className="text-2xl font-bold text-text leading-tight">{display}</div>
        <div className="text-xs text-text-muted uppercase tracking-wider font-semibold mt-0.5">{label}</div>
      </div>
    </div>
  );
}
