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

// Dynamically import zoom plugin to avoid SSR issues with window access
let zoomPlugin: any = null;
if (typeof window !== 'undefined') {
  zoomPlugin = require('chartjs-plugin-zoom').default;
}

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  ArcElement,
  ...(zoomPlugin ? [zoomPlugin] : [])
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

  // Calculate the last 12 months for default zoom range
  const defaultZoomRange = useMemo(() => {
    if (safeData.length === 0) return undefined;
    
    const endDate = new Date(safeData[safeData.length - 1].date);
    const startDate = new Date(endDate.getFullYear(), endDate.getMonth() - 11, 1);
    
    // Find indices for start and end dates
    const startIndex = labels.findIndex(label => {
      const labelDate = new Date(label);
      return labelDate >= startDate;
    });
    
    const endIndex = labels.length - 1;
    
    if (startIndex === -1) return undefined;
    
    return {
      min: startIndex,
      max: endIndex,
    };
  }, [safeData, labels]);

  const options: ChartOptions<'line'> = useMemo(() => ({
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
      zoom: {
        pan: {
          enabled: true,
          mode: 'x' as const,
          onPanComplete: (context: any) => {
            // Force chart update after pan
            context.chart.update('none');
          },
        },
        zoom: {
          wheel: {
            enabled: true,
          },
          pinch: {
            enabled: true,
          },
          mode: 'x' as const,
          onZoomComplete: (context: any) => {
            // Force chart update after zoom
            context.chart.update('none');
          },
        },
        // Set initial zoom range to last 12 months
        limits: defaultZoomRange ? {
          x: {
            min: defaultZoomRange.min,
            max: defaultZoomRange.max,
          },
        } : undefined,
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
          maxRotation: 45,
          minRotation: 45,
          autoSkip: true,
          callback: (value, index) => {
            // Chart.js passes the numeric index to the tick callback
            const date = chartData.labels[index as number];
            if (!date) return '';
            
            // Parse the date to determine appropriate formatting based on data density
            const parts = date.split('-');
            if (parts.length !== 3) return date;
            const year = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10);
            
            // Calculate total months in the dataset
            const totalMonths = labels.length;
            
            // If more than ~24 months visible, show only years
            if (totalMonths > 24) {
              return year.toString();
            }
            // Otherwise show month/year
            return formatDate(date);
          },
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
          callback: (value) => Math.round(value as number),
        },
      },
    },
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
  }), [chartData, defaultZoomRange, labels.length]);

  if (safeData.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
        <h3 className="text-sm font-semibold text-text mb-2">Completions Over Time</h3>
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
