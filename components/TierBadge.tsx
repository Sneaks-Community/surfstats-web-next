import { getTierColor } from '@/lib/tierColors';

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
      className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors.bg} ${colors.text} ${colors.border} border ${className}`}
    >
      {variant === 'full' ? `Tier ${tier}` : `T${tier}`}
    </span>
  );
}
