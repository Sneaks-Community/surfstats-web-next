'use client';

import { Line } from 'react-chartjs-2';
import type { ChartOptions, TooltipItem } from 'chart.js';
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
import { TIER_COLORS, DEFAULT_COLOR } from '@/lib/tierColors';

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

interface PerformanceData {
  date: string;
  avgTime: number;
  mapCount: number;
  tier: number;
}

interface PerformanceTrendChartProps {
  data: PerformanceData[];
}


export default function PerformanceTrendChart({ data }: PerformanceTrendChartProps) {
  // Ensure data is an array and handle edge cases
  const safeData = useMemo(() => Array.isArray(data) ? data : [], [data]);

  // Get unique tiers for legend and colors
  const tiers = useMemo(() => {
    return Array.from(new Set(safeData.map(d => d.tier))).sort((a, b) => a - b);
  }, [safeData]);

  // Transform data for Chart.js - group by date and create datasets per tier
  const chartData = useMemo(() => {
    // Get all unique dates sorted
    const dates = Array.from(new Set(safeData.map(d => d.date))).sort();
    
    return {
      labels: dates,
      datasets: tiers.map(tier => {
        const tierData = dates.map(date => {
          const entry = safeData.find(d => d.date === date && d.tier === tier);
          return entry ? entry.avgTime : null;
        });

        return {
          label: `Tier ${tier}`,
          data: tierData,
          borderColor: TIER_COLORS[tier] || DEFAULT_COLOR,
          backgroundColor: (TIER_COLORS[tier] || DEFAULT_COLOR) + '80', // Add 50% opacity hex suffix
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 6,
        };
      }),
    };
  }, [safeData, tiers]);

  // Format time helper
  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.round(seconds % 60);
    return `${hours > 0 ? `${hours}h ` : ''}${minutes}m ${secs}s`;
  };

  // Format date helper
  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const options: ChartOptions<'line'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          usePointStyle: true,
          boxWidth: 8,
          boxHeight: 8,
          font: {
            size: 12,
          },
          padding: 10,
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
        displayColors: true,
        titleFont: {
          size: 14,
          weight: 'bold' as const,
        },
        bodyFont: {
          size: 13,
        },
        callbacks: {
          title: (tooltipItems) => {
            const date = tooltipItems[0].label as string;
            return formatDate(date);
          },
          label: (context) => {
            const dataset = context.dataset as { label: string };
            const avgTime = context.parsed.y ?? 0;
            const tier = dataset.label.replace('Tier ', '');
            return `T${tier}: ${formatTime(avgTime)}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          color: 'rgba(148, 163, 184, 0.2)',
        },
        ticks: {
          color: '#94a3b8',
          font: {
            size: 12,
          },
          callback: (value) => {
            const date = value as string;
            return formatDate(date);
          },
        },
      },
      y: {
        grid: {
          color: 'rgba(148, 163, 184, 0.2)',
        },
        ticks: {
          color: '#94a3b8',
          font: {
            size: 12,
          },
          callback: (value) => {
            const seconds = Number(value);
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
          },
        },
      },
    },
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
  }), []);

  // If no data, show empty state
  if (chartData.labels.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
        <h3 className="text-sm font-semibold text-text mb-2">Performance Trend</h3>
        <div className="flex-1 min-h-[200px] flex items-center justify-center text-text-muted text-sm">
          No completion history
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
      <h3 className="text-sm font-semibold text-text mb-2">Performance Trend</h3>
      <div className="flex-1 min-h-[200px]">
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
}
