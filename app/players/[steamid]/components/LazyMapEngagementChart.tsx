'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type MapEngagementChartImpl from './MapEngagementChart';

const MapEngagementChart = dynamic(() => import('./MapEngagementChart'), {
  ssr: false,
  loading: () => (
    <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col animate-pulse">
      <div className="h-4 w-32 bg-surface-hover rounded mb-4" />
      <div className="flex-1 min-h-[200px] bg-surface-hover rounded" />
    </div>
  ),
});

export default function LazyMapEngagementChart(
  props: ComponentProps<typeof MapEngagementChartImpl>
) {
  return <MapEngagementChart {...props} />;
}
