'use client';

import { Line } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LogarithmicScale,
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
  LogarithmicScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  ArcElement,
);

interface CompletionsOverTimeData {
  date: string;
  count: number;
}

interface CompletionsOverTimeChartProps {
  data: CompletionsOverTimeData[];
}

export default function CompletionsOverTimeChart({ data }: CompletionsOverTimeChartProps) {
  const safeData = useMemo(() => Array.isArray(data) ? data : [], [data]);

  const formatDate = (dateStr: string): string => {
    // MySQL returns dates as 'YYYY-MM-01', parse manually to avoid timezone issues
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // months are 0-indexed
    const date = new Date(year, month, 1);
    return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  };

  const labels = useMemo(() => safeData.map(d => d.date), [safeData]);
  const counts = useMemo(() => safeData.map(d => d.count), [safeData]);

  // Calculate max count for Y-axis upper bound
  const maxCount = useMemo(() => {
    if (counts.length === 0) return 1;
    return Math.max(...counts);
  }, [counts]);

  const chartData = useMemo(() => ({
    labels,
    datasets: [
      {
        label: 'Completions',
        data: counts,
        borderColor: '#3b82f6', // blue-500
        backgroundColor: 'rgba(59, 130, 246, 0.3)',
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointHoverRadius: 6,
      },
    ],
  }), [labels, counts]);

  const options: ChartOptions<'line'> = useMemo(() => {
    // Calculate the upper bound for Y-axis (next power of 10 above maxCount)
    const yAxisMax = maxCount > 1 ? Math.pow(10, Math.ceil(Math.log10(maxCount))) : 1;

    return {
      responsive: true,
      maintainAspectRatio: false,
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
              const date = tooltipItems[0].label as string;
              return formatDate(date);
            },
            label: (context) => {
              const count = context.parsed.y ?? 0;
              return `${count} completion${count !== 1 ? 's' : ''}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            // Only show grid lines at year boundaries (every 12 months)
            color: (context: any) => {
              // Only draw grid line at year boundaries (index divisible by 12)
              if (context.tick && context.tick.index % 12 === 0) {
                return 'rgba(148, 163, 184, 0.2)';
              }
              return 'transparent';
            },
          },
          ticks: {
            color: '#94a3b8',
            font: {
              size: 12,
            },
            maxRotation: 45,
            minRotation: 45,
            autoSkip: false,
            callback: (value, index) => {
              // Chart.js passes the numeric index to the tick callback
              const date = chartData.labels[index as number];
              if (!date) return '';
              
              // Parse the date to determine appropriate formatting based on data density
              const parts = date.split('-');
              if (parts.length !== 3) return date;
              const year = parseInt(parts[0], 10);
              
              // Calculate total months in the dataset
              const totalMonths = labels.length;
              
              // If more than ~24 months visible, show only years (once per year)
              if (totalMonths > 24) {
                // Show year label every 12 months (once per year)
                // Index 0 is Jan 2017, index 12 is Jan 2018, etc.
                if (index % 12 === 0) {
                  return year.toString();
                }
                return '';
              }
              // Otherwise show month/year
              return formatDate(date);
            },
          },
        },
        y: {
          type: 'logarithmic',
          min: 1,
          max: yAxisMax,
          grid: {
            color: 'rgba(148, 163, 184, 0.2)',
          },
          ticks: {
            color: '#94a3b8',
            font: {
              size: 12,
            },
            // Only show major ticks (powers of 10) to reduce overlap
            source: 'auto',
            autoSkip: true,
            maxTicksLimit: 6,
            callback: (value) => {
              const rounded = Math.round(value as number);
              // Show the maxCount value (upper bound) and major powers of 10
              if (rounded === maxCount ||
                  rounded === 1 || rounded === 10 || rounded === 100 ||
                  rounded === 1000 || rounded === 10000 || rounded === 100000) {
                return rounded.toLocaleString();
              }
              return '';
            },
          },
        },
      },
      interaction: {
        mode: 'index' as const,
        intersect: false,
      },
    };
  }, [chartData, labels.length, maxCount]);

  if (safeData.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
        <h3 className="text-sm font-semibold text-text mb-2">Completions Over Time (log scale)</h3>
        <div className="flex-1 min-h-[200px] flex items-center justify-center text-text-muted text-sm">
          No completion data available
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
      <h3 className="text-sm font-semibold text-text mb-2">Completions Over Time</h3>
      <div className="flex-1 min-h-[200px]">
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
}
