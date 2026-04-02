'use client';

import { Doughnut } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import {
  Chart as ChartJS,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { useMemo } from 'react';

ChartJS.register(ArcElement, Title, Tooltip, Legend);

interface BonusCompletionData {
  bonus: number;
  completionRate: number; // 0-1
  completions: number;
}

interface BonusCompletionChartProps {
  data: BonusCompletionData[];
}

export default function BonusCompletionChart({ data }: BonusCompletionChartProps) {
  const safeData = useMemo(() => Array.isArray(data) ? data : [], [data]);

  // Generate colors for each bonus slice
  const generateColors = (count: number) => {
    const colors = [];
    const baseHues = [280, 320, 160, 45, 200, 30, 220]; // Various hues for distinction
    
    for (let i = 0; i < count; i++) {
      const hue = baseHues[i % baseHues.length];
      const saturation = 70 + (i % 3) * 5; // 70-85%
      const lightness = 55 + (i % 2) * 5; // 55-60%
      colors.push(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
    }
    
    return colors;
  };

  const chartData = useMemo(() => {
    const labels = safeData.map(d => `Bonus ${d.bonus}`);
    const values = safeData.map(d => d.completions);
    const colors = generateColors(safeData.length);

    return {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          borderColor: '#1e293b', // slate-800
          borderWidth: 2,
          hoverOffset: 8,
        },
      ],
    };
  }, [safeData]);

  const formatPercentage = (rate: number): string => {
    return `${(rate * 100).toFixed(1)}%`;
  };

  const options: ChartOptions<'doughnut'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          usePointStyle: true,
          boxWidth: 10,
          boxHeight: 10,
          font: {
            size: 12,
          },
          padding: 12,
          color: '#94a3b8',
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
          weight: 'bold',
        },
        bodyFont: {
          size: 13,
        },
        callbacks: {
          title: (tooltipItems) => {
            const label = tooltipItems[0].label as string;
            return label;
          },
          label: (context) => {
            const completions = context.parsed as number;
            const rate = safeData[context.dataIndex]?.completionRate ?? 0;
            return [
              `Completions: ${completions.toLocaleString()}`,
              `Completion rate: ${formatPercentage(rate)}`,
            ];
          },
        },
      },
    },
  }), [safeData]);

  if (safeData.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
        <h3 className="text-sm font-semibold text-text mb-2">Bonus Completion Rates</h3>
        <div className="flex-1 min-h-[200px] flex items-center justify-center text-text-muted text-sm">
          No bonus data available
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
      <h3 className="text-sm font-semibold text-text mb-2">Bonus Completion Rates</h3>
      <div className="flex-1 min-h-[200px] flex items-center justify-center">
        <Doughnut data={chartData} options={options} />
      </div>
    </div>
  );
}
