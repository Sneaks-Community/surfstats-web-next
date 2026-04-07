'use client';

import { useEffect, useState } from 'react';
import CompletionsOverTimeChart from './CompletionsOverTimeChart';
import TimeOnMapChart from './TimeOnMapChart';
import CheckpointTimesChart from './CheckpointTimesChart';
import BonusCompletionChart from './BonusCompletionChart';

interface ChartData {
  completionsOverTime: Array<{ date: string; count: number }>;
  timeOnMapData: Array<{ date: string; totalDuration: number }>;
  checkpointAvgTimes: Array<{ checkpoint: number; avgTime: number; sampleSize: number }>;
  wrCheckpointTimes?: Array<{ checkpoint: number; time: number }>;
  bonusCompletionRates: Array<{ bonus: number; completionRate: number; completions: number }>;
  bonusCompletionsOverTime: { [bonus: number]: Array<{ date: string; count: number }> };
  isStageMap: boolean; // true if map has stages (zonetype 3), false for linear maps (zonetype 4)
}

interface MapChartGridProps {
  mapname: string;
}

export default function MapChartGrid({ mapname }: MapChartGridProps) {
  const [data, setData] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch(`/api/maps/${mapname}/stats`);
        if (!response.ok) {
          throw new Error('Failed to fetch map statistics');
        }
        const statsData = await response.json();
        setData(statsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [mapname]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-surface border border-border rounded-xl p-4 h-[250px] flex flex-col animate-pulse">
            <div className="h-4 w-48 bg-surface-hover rounded mb-4" />
            <div className="flex-1 bg-surface-hover rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4 text-center text-text-muted">
        Failed to load map statistics: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-surface border border-border rounded-xl p-4 h-[250px] flex items-center justify-center text-text-muted">
            No data available
          </div>
        ))}
      </div>
    );
  }

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
        isStageMap={data.isStageMap}
      />
      <BonusCompletionChart data={data.bonusCompletionRates} />
    </div>
  );
}
