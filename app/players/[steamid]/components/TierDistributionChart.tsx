'use client';

import { Radar } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { useMemo } from 'react';

ChartJS.register(
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend
);

interface TierDistributionData {
  tier: number;
  linear: number;
  staged: number;
}

interface TierDistributionChartProps {
  data: TierDistributionData[];
}


export default function TierDistributionChart({ data }: TierDistributionChartProps) {
  // Ensure data is an array and handle edge cases
  const safeData = useMemo(() => Array.isArray(data) ? data : [], [data]);

  // Transform data for the radar chart
  const chartData = useMemo(() => {
    // Get all tiers 1-6
    const tiers = Array.from({ length: 6 }, (_, i) => i + 1);

    // Calculate linear and staged completions per tier from array data
    const linearPerTier = tiers.map(tier => {
      const tierData = safeData.find(d => d.tier === tier);
      return tierData?.linear ?? 0;
    });
    
    const stagedPerTier = tiers.map(tier => {
      const tierData = safeData.find(d => d.tier === tier);
      return tierData?.staged ?? 0;
    });

    return {
      labels: tiers.map(t => `Tier ${t}`),
      datasets: [
        {
          label: 'Linear Maps',
          data: linearPerTier,
          borderColor: '#eab308', // yellow-500
          backgroundColor: 'rgba(234, 179, 8, 0.2)',
          pointBackgroundColor: '#eab308', // yellow-500
          pointBorderColor: '#fff',
          pointHoverBackgroundColor: '#fff',
          pointHoverBorderColor: '#eab308', // yellow-500
        },
        {
          label: 'Staged Maps',
          data: stagedPerTier,
          borderColor: '#a855f7', // purple-500
          backgroundColor: 'rgba(168, 85, 247, 0.2)',
          pointBackgroundColor: '#a855f7', // purple-500
          pointBorderColor: '#fff',
          pointHoverBackgroundColor: '#fff',
          pointHoverBorderColor: '#a855f7', // purple-500
        },
      ],
    };
  }, [safeData]);

  const options: ChartOptions<'radar'> = useMemo(() => ({
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
            return tooltipItems[0].label || '';
          },
          label: (context) => {
            const count = context.parsed.r as number;
            const datasetLabel = context.dataset.label;
            return `${datasetLabel}: ${count} maps`;
          },
        },
      },
    },
    scales: {
      r: {
        angleLines: {
          color: 'rgba(148, 163, 184, 0.2)',
        },
        grid: {
          color: 'rgba(148, 163, 184, 0.2)',
        },
        pointLabels: {
          color: '#94a3b8',
          font: {
            size: 12,
          },
        },
        ticks: {
          display: false, // Hide value labels (50, 100, 200, etc.)
        },
        suggestedMin: 0,
        // Auto-scale the radial axis based on data
        max: Math.max(
          ...safeData.map(d => d.linear),
          ...safeData.map(d => d.staged)
        ) * 1.1, // Add 10% padding for visual clarity
      },
    },
  }), [safeData]);

  // If no data, show empty state
  if (chartData.labels.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-2 h-full flex flex-col">
        <div className="flex-1 min-h-[200px] flex items-center justify-center text-text-muted text-sm">
          No completions
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-2 h-full flex flex-col">
      <div className="flex-1 min-h-[200px]">
        <Radar data={chartData} options={options} />
      </div>
    </div>
  );
}
