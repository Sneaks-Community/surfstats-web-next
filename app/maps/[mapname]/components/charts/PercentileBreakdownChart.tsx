'use client';

import { Bar } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
} from 'chart.js';
import { useMemo } from 'react';

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip);

interface PercentileData {
  wrTime: number | null;
  p1Time: number | null;
  p10Time: number | null;
  medianTime: number | null;
  avgTime: number | null;
}

interface PercentileBreakdownChartProps {
  data: PercentileData | null;
}

const LABELS = ['WR', 'Top 1%', 'Top 10%', 'Median', 'Average'];

const COLORS = {
  wr: 'hsl(142, 71%, 45%)',    // emerald-600
  p1: 'hsl(217, 91%, 60%)',    // blue-500
  p10: 'hsl(262, 83%, 58%)',   // violet-500
  median: 'hsl(35, 91%, 55%)', // amber-500
  avg: 'hsl(0, 84%, 60%)',     // red-500
};

const BG_COLORS = {
  wr: 'rgba(34, 197, 94, 0.8)',
  p1: 'rgba(59, 130, 246, 0.8)',
  p10: 'rgba(139, 92, 246, 0.8)',
  median: 'rgba(245, 158, 11, 0.8)',
  avg: 'rgba(239, 68, 68, 0.8)',
};

const DATA_KEYS = ['wrTime', 'p1Time', 'p10Time', 'medianTime', 'avgTime'] as const;

const formatTime = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${minutes}:${secs.toString().padStart(2, '0')}.${ms}`;
};

export default function PercentileBreakdownChart({ data }: PercentileBreakdownChartProps) {
  const hasData = useMemo(() => {
    if (!data) return false;
    return data.wrTime !== null || data.p1Time !== null || data.p10Time !== null ||
           data.medianTime !== null || data.avgTime !== null;
  }, [data]);

  const chartData = useMemo(() => {
    if (!data) return null;

    const values = DATA_KEYS.map(key => data[key]);

    return {
      labels: LABELS,
      datasets: [
        {
          data: values,
          backgroundColor: Object.values(BG_COLORS),
          borderColor: Object.values(COLORS),
          borderWidth: 1,
          borderRadius: 4,
          barPercentage: 0.7,
          categoryPercentage: 0.8,
        },
      ],
    };
  }, [data]);

  const options: ChartOptions<'bar'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y' as const,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: 'rgba(30, 41, 59, 0.95)',
        titleColor: '#f8fafc',
        bodyColor: '#e2e8f0',
        borderColor: 'rgba(148, 163, 184, 0.5)',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 12,
        displayColors: true,
        titleFont: {
          size: 14,
          weight: 'bold',
        },
        bodyFont: {
          size: 13,
        },
        callbacks: {
          title: (tooltipItems) => {
            const label = tooltipItems[0].label;
            return label;
          },
          label: (context) => {
            const value = context.parsed.x;
            if (value === null || value === undefined) return 'N/A';
            const numValue = typeof value === 'number' ? value : Number(value);
            return `Time: ${formatTime(numValue)} (${numValue.toFixed(1)}s)`;
          },
        },
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        grid: {
          color: 'rgba(148, 163, 184, 0.15)',
        },
        ticks: {
          color: '#94a3b8',
          font: {
            size: 11,
          },
          callback: (value) => `${Math.round(value as number)}s`,
          maxTicksLimit: 6,
        },
        title: {
          display: true,
          text: 'Time (seconds)',
          color: '#94a3b8',
          font: {
            size: 12,
          },
        },
      },
      y: {
        grid: {
          display: false,
        },
        ticks: {
          color: '#94a3b8',
          font: {
            size: 12,
            weight: 600,
          },
        },
      },
    },
  }), []);

  return (
    <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
      <h3 className="text-sm font-semibold text-text mb-2">Completion Time Percentiles</h3>
      {!hasData ? (
        <div className="flex-1 min-h-[200px] flex items-center justify-center text-text-muted text-sm">
          No completion data available
        </div>
      ) : (
        <div className="flex-1 min-h-[200px]">
          <Bar data={chartData!} options={options} />
        </div>
      )}
    </div>
  );
}
