'use client';

import { Line } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { useMemo } from 'react';
import ChartEmptyState from '@/components/ChartEmptyState';
import { chartTooltip, useChartTheme } from '@/hooks/useChartTheme';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface CheckpointTimeData {
  checkpoint: number;
  avgTime: number; // seconds
  sampleSize: number;
}

interface WRCheckpointTimeData {
  checkpoint: number;
  time: number;
}

interface CheckpointTimesChartProps {
  data: CheckpointTimeData[];
  wrData?: WRCheckpointTimeData[];
  finishTime?: {
    avgTime: number | null;
    wrTime: number | null;
  };
  isStageMap?: boolean; // true: stages (zonetype 3); false: linear checkpoints (zonetype 4)
}

export default function CheckpointTimesChart({ data, wrData, finishTime, isStageMap = false }: CheckpointTimesChartProps) {
  const chartTheme = useChartTheme();
  const safeData = useMemo(() => Array.isArray(data) ? data : [], [data]);
  const safeWRData = useMemo(() => Array.isArray(wrData) ? wrData : [], [wrData]);
  const safeFinishTime = useMemo(() => finishTime || { avgTime: null, wrTime: null }, [finishTime]);

  const formatTime = (seconds: number): string => {
    return `${seconds.toFixed(1)}s`;
  };

  const chartData = useMemo(() => {
    const labels = safeData.map(d => {
      if (isStageMap) {
        return `S${d.checkpoint}`;
      }
      return `CP${d.checkpoint}`;
    });

    labels.push('Finish');

    const avgTimes: Array<number | null> = safeData.map(d => d.avgTime);

    if (safeFinishTime.avgTime !== null) {
      avgTimes.push(safeFinishTime.avgTime);
    } else {
      avgTimes.push(null);
    }

    const wrTimeMap = new Map(safeWRData.map(cp => [cp.checkpoint, cp.time]));

    // Aligned to the average's checkpoints; null where the WR run lacks that checkpoint.
    const wrTimes = safeData.map(d => wrTimeMap.get(d.checkpoint) ?? null);

    if (safeFinishTime.wrTime !== null) {
      wrTimes.push(safeFinishTime.wrTime);
    } else {
      wrTimes.push(null);
    }

    return {
      labels,
      datasets: [
        {
          label: 'Average Time',
          data: avgTimes,
          borderColor: '#8b5cf6', // violet-500
          backgroundColor: 'rgba(139, 92, 246, 0.3)',
          fill: true,
          tension: 0,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#8b5cf6',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
        },
        ...(wrData && wrData.length > 0 ? [{
          label: 'WR Time',
          data: wrTimes,
          borderColor: '#10b981', // emerald-500
          backgroundColor: 'rgba(16, 185, 129, 0.3)',
          fill: false,
          tension: 0,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: '#10b981',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          showLine: true,
        }] : []),
      ],
    };
  }, [safeData, safeWRData, wrData, safeFinishTime, isStageMap]);

  const options: ChartOptions<'line'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: {
          color: chartTheme.textMuted,
          font: {
            size: 12,
          },
          usePointStyle: false,
          pointStyle: 'rect',
          boxWidth: 8,
          boxHeight: 8,
        },
      },
      tooltip: {
        ...chartTooltip(chartTheme),
        displayColors: false,
        callbacks: {
          title: (tooltipItems) => {
            const label = tooltipItems[0].label;
            if (label === 'Finish') {
              return 'Finish';
            }
            // 'CP1' or 'S1' becomes 'CP 1' or 'S 1'.
            const match = label.match(/(CP|S)(\d+)/);
            if (match) {
              const type = match[1];
              const num = match[2];
              return `${type} ${num}`;
            }
            return label;
          },
          label: (context) => {
            const datasetIndex = context.datasetIndex;
            const value = context.parsed.y ?? 0;
            const label = context.label;
            
            if (datasetIndex === 0) {
              return `Avg: ${formatTime(value)}`;
            } else if (datasetIndex === 1 && wrData && wrData.length > 0) {
              if (label === 'Finish') {
                return `WR: ${formatTime(value)}`;
              }
              return `WR: ${formatTime(value)}`;
            }
            return formatTime(value);
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: chartTheme.textMuted,
          font: {
            size: 11,
          },
          maxRotation: 0,
        },
      },
      y: {
        beginAtZero: true,
        grid: {
          color: chartTheme.grid,
        },
        ticks: {
          color: chartTheme.textMuted,
          font: {
            size: 12,
          },
          callback: (value) => formatTime(value as number),
        },
      },
    },
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
  }), [wrData, chartTheme]);

  if (safeData.length === 0) {
    return (
      <ChartEmptyState
        title="Checkpoint Times"
        message={isStageMap ? 'No stage time data available' : 'No checkpoint time data available'}
      />
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
      <h3 className="text-sm font-semibold text-text mb-2">Checkpoint Times</h3>
      <div className="flex-1 min-h-[200px]">
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
}
