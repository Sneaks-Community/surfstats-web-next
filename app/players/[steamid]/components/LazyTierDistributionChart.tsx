'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type TierDistributionChartImpl from './TierDistributionChart';

// Lazy-load the chart.js-backed chart so its bundle is fetched on the client
// after hydration, keeping the player route's initial JS small.
const TierDistributionChart = dynamic(() => import('./TierDistributionChart'), {
  ssr: false,
  loading: () => (
    <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col animate-pulse">
      <div className="h-4 w-32 bg-surface-hover rounded mb-4" />
      <div className="flex-1 min-h-[200px] bg-surface-hover rounded" />
    </div>
  ),
});

export default function LazyTierDistributionChart(
  props: ComponentProps<typeof TierDistributionChartImpl>
) {
  return <TierDistributionChart {...props} />;
}
