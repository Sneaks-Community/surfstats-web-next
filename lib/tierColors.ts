// Intentionally not theme-aware: difficulty colors stay the same in both themes.

export interface TierColor {
  bg: string;
  text: string;
  border: string;
}

/** Tailwind classes from green (tier 1, easiest) to red (tier 6+, hardest). */
export function getTierColor(tier: number | string): TierColor {
  // Tier can arrive as a string after React serialization.
  const numericTier = typeof tier === 'string' ? parseInt(tier, 10) : tier;
  
  if (numericTier <= 1) {
    return {
      bg: 'bg-emerald-500/20',
      text: 'text-emerald-400',
      border: 'border-emerald-500/30',
    };
  } else if (numericTier === 2) {
    return {
      bg: 'bg-lime-500/20',
      text: 'text-lime-400',
      border: 'border-lime-500/30',
    };
  } else if (numericTier === 3) {
    return {
      bg: 'bg-yellow-500/20',
      text: 'text-yellow-400',
      border: 'border-yellow-500/30',
    };
  } else if (numericTier === 4) {
    return {
      bg: 'bg-orange-500/20',
      text: 'text-orange-400',
      border: 'border-orange-500/30',
    };
  } else if (numericTier === 5) {
    return {
      bg: 'bg-orange-600/20',
      text: 'text-orange-500',
      border: 'border-orange-600/30',
    };
  } else {
    return {
      bg: 'bg-red-500/20',
      text: 'text-red-400',
      border: 'border-red-500/30',
    };
  }
}
