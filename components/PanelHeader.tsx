import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';

interface PanelHeaderProps {
  icon: LucideIcon;
  title: string;
  /** Icon color class; defaults to the theme primary. */
  iconClassName?: string;
  /** Optional trailing link (e.g. "View all"). */
  action?: { href: string; label: string };
}

/**
 * The titled header bar shared across dashboard panels
 * (icon + heading, optional trailing action link).
 */
export default function PanelHeader({
  icon: Icon,
  title,
  iconClassName = 'text-primary',
  action,
}: PanelHeaderProps) {
  return (
    <div className="px-4 py-3 border-b border-border bg-surface/50 flex items-center justify-between gap-2">
      <h2 className="text-lg font-semibold text-text flex items-center gap-2">
        <Icon className={`h-5 w-5 ${iconClassName}`} />
        {title}
      </h2>
      {action && (
        <Link
          href={action.href}
          className="text-sm text-primary hover:underline whitespace-nowrap"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
