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

interface TimeOnMapData {
  date: string;
  totalDuration: number; // in seconds
}

interface TimeOnMapChartProps {
  data: TimeOnMapData[];
}

const formatHours = (hours: number): string => {
  const totalDays = Math.round(hours / 24);
  if (totalDays >= 1) {
    return `${totalDays}d`;
  }
  const totalHours = Math.round(hours);
  return `${totalHours}h`;
};

const formatHoursDetailed = (hours: number): string => {
  const totalHours = Math.round(hours);
  const days = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  
  if (days > 0) {
    return `${days}d ${remainingHours}h`;
  }
  return `${totalHours}h`;
};

const formatDate = (date: string): string => {
  // Input: "2017-10-01" → Output: "10/2017"
  const [year, month] = date.split('-');
  return `${month}/${year}`;
};

export default function TimeOnMapChart({ data }: TimeOnMapChartProps) {
  const safeData = useMemo(() => Array.isArray(data) ? data : [], [data]);

  const chartData = useMemo(() => {
    const labels = safeData.map(d => formatDate(d.date));
    const durations = safeData.map(d => d.totalDuration);

    return {
      labels,
      datasets: [
        {
          label: 'Time on Map',
          data: durations,
          borderColor: '#fdba74', // peach-400
          backgroundColor: 'rgba(251, 146, 60, 0.3)',
          fill: true,
          tension: 0.1,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointBackgroundColor: '#3b82f6',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
        },
      ],
    };
  }, [safeData]);

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
            const date = tooltipItems[0].label;
            return `Date: ${date}`;
          },
          label: (context) => {
            const value = context.parsed.y ?? 0;
            return `Total Time: ${formatHoursDetailed(value)}`;
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
            size: 9,
          },
          maxRotation: 0,
          minRotation: 0,
          autoSkip: true,
          maxTicksLimit: 12,
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
          callback: (value) => formatHours(value as number),
        },
      },
    },
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
  }), []);

  if (safeData.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
        <h3 className="text-sm font-semibold text-text mb-2">Time on Map</h3>
        <div className="flex-1 min-h-[200px] flex items-center justify-center text-text-muted text-sm">
          No time data available
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
      <h3 className="text-sm font-semibold text-text mb-2">Time on Map</h3>
      <div className="flex-1 min-h-[200px]">
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
}
