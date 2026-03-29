/**
 * Utility functions for tier colorization
 * Tiers range from 1 (easiest) to 6+ (hardest)
 * Colors progress from green to red
 * 
 * Note: Tier colors are intentionally NOT theme-aware as they represent
 * difficulty levels and should remain consistent across themes.
 */

export interface TierColor {
  bg: string;
  text: string;
  border: string;
}

/**
 * Get color scheme for a given tier number
 * @param tier - The tier number (1-6, any value >= 6 uses the hardest color)
 * @returns Object with Tailwind CSS classes for bg, text, and border colors
 */
export function getTierColor(tier: number | string): TierColor {
  // Ensure tier is a number (handles string values from React serialization)
  const numericTier = typeof tier === 'string' ? parseInt(tier, 10) : tier;
  
  if (numericTier <= 1) {
    // Tier 1: Green (easiest)
    return {
      bg: 'bg-emerald-500/20',
      text: 'text-emerald-400',
      border: 'border-emerald-500/30',
    };
  } else if (numericTier === 2) {
    // Tier 2: Lime/Yellow-green
    return {
      bg: 'bg-lime-500/20',
      text: 'text-lime-400',
      border: 'border-lime-500/30',
    };
  } else if (numericTier === 3) {
    // Tier 3: Yellow
    return {
      bg: 'bg-yellow-500/20',
      text: 'text-yellow-400',
      border: 'border-yellow-500/30',
    };
  } else if (numericTier === 4) {
    // Tier 4: Orange
    return {
      bg: 'bg-orange-500/20',
      text: 'text-orange-400',
      border: 'border-orange-500/30',
    };
  } else if (numericTier === 5) {
    // Tier 5: Red-orange
    return {
      bg: 'bg-orange-600/20',
      text: 'text-orange-500',
      border: 'border-orange-600/30',
    };
  } else {
    // Tier 6+: Red (hardest)
    return {
      bg: 'bg-red-500/20',
      text: 'text-red-400',
      border: 'border-red-500/30',
    };
  }
}

/**
 * Get a simple text color for a given tier number
 * @param tier - The tier number
 * @returns Tailwind text color class
 */
export function getTierTextColor(tier: number): string {
  const colors: Record<number, string> = {
    1: 'text-emerald-400',
    2: 'text-lime-400',
    3: 'text-yellow-400',
    4: 'text-orange-400',
    5: 'text-orange-500',
  };
  
  return colors[tier] ?? 'text-red-400';
}

/**
 * Tier color constants for chart components
 * These hex colors match the Tailwind classes used in getTierColor()
 */
export const TIER_COLORS: Record<number, string> = {
  1: '#10b981', // emerald-500
  2: '#84cc16', // lime-500
  3: '#eab308', // yellow-500
  4: '#f97316', // orange-500
  5: '#ea580c', // orange-600
  6: '#ef4444', // red-500
};

/**
 * Default color for tiers beyond the defined range (e.g., tier > 6)
 */
export const DEFAULT_COLOR = '#a855f7'; // purple-500