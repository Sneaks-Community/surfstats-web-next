import { getTierColor } from '@/lib/tierColors';
import { Mountain } from 'lucide-react';

interface TierBadgeProps {
  tier: number;
  className?: string;
  variant?: 'compact' | 'full'; // 'compact' = T<number>, 'full' = Tier <number>
}

/**
 * Badge displaying the tier with color coding
 * @param tier - The tier number to display
 * @param className - Additional CSS classes
 * @param variant - Display format: 'compact' (T1) or 'full' (Tier 1)
 */
export default function TierBadge({ tier, className = '', variant = 'compact' }: TierBadgeProps) {
  const colors = getTierColor(tier);
  
  return (
    <span
      className={`text-sm px-3 py-1 rounded font-bold tracking-wider uppercase flex items-center gap-1 ${colors.bg} ${colors.text} ${colors.border} border ${className}`}
    >
      <Mountain className="h-3 w-3" />
      {variant === 'full' ? `Tier ${tier}` : `T${tier}`}
    </span>
  );
}
