'use client';

import dynamic from 'next/dynamic';
import ChartSkeleton from '@/components/ChartSkeleton';
import type { MapChartData } from '@/lib/map-stats-cache';

// Lazy-load the chart.js-backed charts so their (heavy) bundle is only fetched
// on the client after hydration, keeping the map route's initial JS small.
const loading = () => <ChartSkeleton height={250} titleWidth={192} />;

const CompletionsOverTimeChart = dynamic(() => import('./CompletionsOverTimeChart'), {
  ssr: false,
  loading,
});
const TimeOnMapChart = dynamic(() => import('./TimeOnMapChart'), {
  ssr: false,
  loading,
});
const CheckpointTimesChart = dynamic(() => import('./CheckpointTimesChart'), {
  ssr: false,
  loading,
});
const PercentileBreakdownChart = dynamic(() => import('./PercentileBreakdownChart'), {
  ssr: false,
  loading,
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
