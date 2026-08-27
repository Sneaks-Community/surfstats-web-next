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
import ChartEmptyState from '@/components/ChartEmptyState';
import { useChartTheme } from '@/hooks/useChartTheme';

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
  const chartTheme = useChartTheme();
  // Ensure data is an array and handle edge cases
  const safeData = useMemo(() => Array.isArray(data) ? data : [], [data]);

  // Transform data for the radar chart
  const chartData = useMemo(() => {
    // Derive the tier axes from the data, which the server pads to its full tier
    // range (up to 6, 10, etc. depending on the server's map pool). This keeps
    // the radar and the L/S summary in agreement and avoids both dropped high
    // tiers and blank trailing axes.
    const tiers = Array.from(new Set(safeData.map(d => d.tier))).sort((a, b) => a - b);

    // Build Map for O(1) lookups - computed directly within outer useMemo
    const dataMap = new Map<number, { linear: number; staged: number }>();
    for (const d of safeData) {
      dataMap.set(d.tier, { linear: d.linear, staged: d.staged });
    }

    // O(1) lookups instead of O(n) find() calls
    const linearPerTier = tiers.map(tier => dataMap.get(tier)?.linear ?? 0);
    const stagedPerTier = tiers.map(tier => dataMap.get(tier)?.staged ?? 0);

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
        backgroundColor: chartTheme.surface,
        titleColor: chartTheme.text,
        bodyColor: chartTheme.textMuted,
        borderColor: chartTheme.border,
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
            const count = context.parsed.r;
            const datasetLabel = context.dataset.label;
            return `${datasetLabel}: ${count} maps`;
          },
        },
      },
    },
    scales: {
      r: {
        angleLines: {
          color: chartTheme.grid,
        },
        grid: {
          color: chartTheme.grid,
        },
        pointLabels: {
          color: chartTheme.textMuted,
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
  }), [safeData, chartTheme]);

  // Summary stats for the info panel
  const summaryInfo = useMemo(() => {
    if (safeData.length === 0) return null;
    const totalLinear = safeData.reduce((sum, d) => sum + d.linear, 0);
    const totalStaged = safeData.reduce((sum, d) => sum + d.staged, 0);
    const bestTier = safeData.reduce((best, d) =>
      (d.linear + d.staged) > (best.linear + best.staged) ? d : best
    );
    return { totalLinear, totalStaged, bestTier: bestTier.tier };
  }, [safeData]);

  // If no data, show empty state
  if (chartData.labels.length === 0) {
    return <ChartEmptyState title="Tier Distribution" message="No completions" />;
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-2 h-full flex flex-col">
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="text-sm font-semibold text-text">Tier Distribution</h3>
        {summaryInfo && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span className="text-yellow-500">L:{summaryInfo.totalLinear}</span>
            <span className="text-purple-500">S:{summaryInfo.totalStaged}</span>
          </div>
        )}
      </div>
      <div className="flex-1 min-h-[200px]">
        <Radar data={chartData} options={options} />
      </div>
    </div>
  );
}
