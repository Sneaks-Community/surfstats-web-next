import { getTierColor } from '@/lib/tierColors';

interface TierBadgeProps {
  tier: number;
  className?: string;
}

/**
 * Badge displaying the tier in "T<number>" format with color coding
 */
export default function TierBadge({ tier, className = '' }: TierBadgeProps) {
  const colors = getTierColor(tier);
  
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors.bg} ${colors.text} ${colors.border} border ${className}`}
    >
      T{tier}
    </span>
  );
}
