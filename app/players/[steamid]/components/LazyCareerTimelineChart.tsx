'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type CareerTimelineChartImpl from './CareerTimelineChart';

const CareerTimelineChart = dynamic(() => import('./CareerTimelineChart'), {
  ssr: false,
  loading: () => (
    <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col animate-pulse">
      <div className="h-4 w-32 bg-surface-hover rounded mb-4" />
      <div className="flex-1 min-h-[200px] bg-surface-hover rounded" />
    </div>
  ),
});

export default function LazyCareerTimelineChart(
  props: ComponentProps<typeof CareerTimelineChartImpl>
) {
  return <CareerTimelineChart {...props} />;
}
