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
  ArcElement,
} from 'chart.js';
import { useMemo } from 'react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  ArcElement
);

interface CheckpointTimeData {
  checkpoint: number;
  avgTime: number; // in seconds
  sampleSize: number;
}

interface WRCheckpointTimeData {
  checkpoint: number;
  time: number;
}

interface CheckpointTimesChartProps {
  data: CheckpointTimeData[];
  wrData?: WRCheckpointTimeData[];
  isStageMap?: boolean; // true if map has stages (zonetype 3), false for linear maps (zonetype 4)
}

export default function CheckpointTimesChart({ data, wrData, isStageMap = false }: CheckpointTimesChartProps) {
  const safeData = useMemo(() => Array.isArray(data) ? data : [], [data]);
  const safeWRData = useMemo(() => Array.isArray(wrData) ? wrData : [], [wrData]);

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
    const avgTimes = safeData.map(d => d.avgTime);

    // Create a map of checkpoint -> WR time for easy lookup
    const wrTimeMap = new Map(safeWRData.map(cp => [cp.checkpoint, cp.time]));

    // Get WR times aligned with average data checkpoints (only include if WR has that checkpoint)
    const wrTimes = safeData.map(d => wrTimeMap.get(d.checkpoint) ?? null);

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
  }, [safeData, safeWRData, wrData, isStageMap]);

  const options: ChartOptions<'line'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: {
          color: '#94a3b8',
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
        backgroundColor: 'rgba(30, 41, 59, 0.95)',
        titleColor: '#f8fafc',
        bodyColor: '#e2e8f0',
        borderColor: 'rgba(148, 163, 184, 0.5)',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 12,
        displayColors: false,
        titleFont: {
          size: 14,
          weight: 'bold',
        },
        bodyFont: {
          size: 13,
        },
        callbacks: {
          title: (tooltipItems) => {
            const label = tooltipItems[0].label as string;
            // Extract number from either 'CP1' or 'S1' format
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
            
            if (datasetIndex === 0) {
              // Average Time dataset
              return `Avg: ${formatTime(value)}`;
            } else if (datasetIndex === 1 && wrData && wrData.length > 0) {
              // WR Time dataset
              const checkpoint = safeData[context.dataIndex]?.checkpoint;
              const wrRecord = safeWRData.find(cp => cp.checkpoint === checkpoint);
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
          color: '#94a3b8',
          font: {
            size: 11,
          },
          maxRotation: 0,
        },
      },
      y: {
        beginAtZero: true,
        grid: {
          color: 'rgba(148, 163, 184, 0.2)',
        },
        ticks: {
          color: '#94a3b8',
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
  }), [safeData, safeWRData, wrData]);

  if (safeData.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
        <h3 className="text-sm font-semibold text-text mb-2">Checkpoint Times</h3>
        <div className="flex-1 min-h-[200px] flex items-center justify-center text-text-muted text-sm">
          {isStageMap ? 'No stage time data available' : 'No checkpoint time data available'}
        </div>
      </div>
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
