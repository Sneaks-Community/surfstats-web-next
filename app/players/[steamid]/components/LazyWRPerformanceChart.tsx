'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type WRPerformanceChartImpl from './WRPerformanceChart';

// Lazy-load the chart.js-backed chart so its bundle is fetched on the client
// after hydration, keeping the player route's initial JS small.
const WRPerformanceChart = dynamic(() => import('./WRPerformanceChart'), {
  ssr: false,
  loading: () => (
    <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col animate-pulse">
      <div className="h-4 w-32 bg-surface-hover rounded mb-4" />
      <div className="flex-1 min-h-[200px] bg-surface-hover rounded" />
    </div>
  ),
});

export default function LazyWRPerformanceChart(
  props: ComponentProps<typeof WRPerformanceChartImpl>
) {
  return <WRPerformanceChart {...props} />;
}
