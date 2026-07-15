'use client';

import dynamic from 'next/dynamic';
import type { MapChartData } from '@/lib/valkey-map-stats-cache';

// Lazy-load the chart.js-backed charts so their (heavy) bundle is only fetched
// on the client after hydration, keeping the map route's initial JS small.
const ChartSkeleton = () => (
  <div className="bg-surface border border-border rounded-xl p-4 h-[250px] flex flex-col animate-pulse">
    <div className="h-4 w-48 bg-surface-hover rounded mb-4" />
    <div className="flex-1 bg-surface-hover rounded" />
  </div>
);

const CompletionsOverTimeChart = dynamic(() => import('./CompletionsOverTimeChart'), {
  ssr: false,
  loading: ChartSkeleton,
});
const TimeOnMapChart = dynamic(() => import('./TimeOnMapChart'), {
  ssr: false,
  loading: ChartSkeleton,
});
const CheckpointTimesChart = dynamic(() => import('./CheckpointTimesChart'), {
  ssr: false,
  loading: ChartSkeleton,
});
const PercentileBreakdownChart = dynamic(() => import('./PercentileBreakdownChart'), {
  ssr: false,
  loading: ChartSkeleton,
});

interface MapChartGridProps {
  data: MapChartData;
}

export default function MapChartGrid({ data }: MapChartGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <CompletionsOverTimeChart
        data={data.completionsOverTime}
        bonusData={data.bonusCompletionsOverTime}
      />
      <TimeOnMapChart data={data.timeOnMapData} />
      <CheckpointTimesChart
        data={data.checkpointAvgTimes}
        wrData={data.wrCheckpointTimes}
        finishTime={data.finishTime}
        isStageMap={data.isStageMap}
      />
      <PercentileBreakdownChart data={data.percentileTimes} />
    </div>
  );
}
