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
} from 'chart.js';
import { useMemo } from 'react';
import ChartEmptyState from '@/components/ChartEmptyState';
import { chartTooltip, useChartTheme } from '@/hooks/useChartTheme';

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
);

interface CompletionsOverTimeData {
  date: string;
  count: number;
}

type BonusTimeSeriesData = Record<number, Array<{ date: string; count: number }>>;

interface CompletionsOverTimeChartProps {
  data: CompletionsOverTimeData[];
  bonusData: BonusTimeSeriesData;
}

const BONUS_HUES = [280, 320, 160, 45, 200, 30, 220, 10, 180, 260];

/** A distinct color per bonus series; `alpha` sets its opacity. */
const bonusColor = (i: number, alpha = 1): string =>
  `hsla(${BONUS_HUES[i % BONUS_HUES.length]}, ${70 + (i % 3) * 5}%, ${55 + (i % 2) * 5}%, ${alpha})`;

/** Year boundary for a `YYYY-MM-DD` bucket label. */
const isJanuary = (label: string | undefined): boolean => label?.split('-')[1] === '01';

export default function CompletionsOverTimeChart({ data, bonusData }: CompletionsOverTimeChartProps) {
  const chartTheme = useChartTheme();
  const safeData = useMemo(() => Array.isArray(data) ? data : [], [data]);
  const safeBonusData: BonusTimeSeriesData = useMemo(() => bonusData, [bonusData]);

  const formatDate = (dateStr: string): string => {
    // MySQL returns 'YYYY-MM-01'; parsed by hand to avoid timezone issues.
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // months are 0-indexed
    const date = new Date(year, month, 1);
    return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  };

  const labels = useMemo(() => safeData.map(d => d.date), [safeData]);
  const counts = useMemo(() => safeData.map(d => d.count), [safeData]);

  // Y-axis upper bound, across the map and every bonus series.
  const maxCount = useMemo(() => {
    const allCounts = [...counts];
    
    Object.values(safeBonusData).forEach((bonusSeries: Array<{ date: string; count: number }>) => {
      bonusSeries.forEach((d) => allCounts.push(d.count));
    });
    
    if (allCounts.length === 0) return 1;
    return Math.max(...allCounts);
  }, [counts, safeBonusData]);

  const chartData = useMemo(() => {
    const datasets: Array<{
      label: string;
      data: Array<number | null>;
      borderColor: string;
      backgroundColor: string;
      fill: boolean;
      tension: number;
      pointRadius: number;
      pointHoverRadius: number;
    }> = [];

    datasets.push({
      label: 'Map',
      data: counts,
      borderColor: '#3b82f6', // blue-500
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      fill: false,
      tension: 0.1,
      pointRadius: 0,
      pointHoverRadius: 4,
    });

    const bonusNumbers = Object.keys(safeBonusData)
      .map(Number)
      .sort((a, b) => a - b);
    
    bonusNumbers.forEach((bonus, index) => {
      const bonusSeries = safeBonusData[bonus] ?? [];
      // Aligned to labels; null where this bonus has no entry for the date.
      const alignedData = labels.map(date => {
        const entry = bonusSeries.find(d => d.date === date);
        return entry ? entry.count : null;
      });

      datasets.push({
        label: `Bonus ${bonus}`,
        data: alignedData,
        borderColor: bonusColor(index),
        backgroundColor: bonusColor(index, 0.1),
        fill: false,
        tension: 0.1,
        pointRadius: 0,
        pointHoverRadius: 4,
      });
    });

    return {
      labels,
      datasets,
    };
  }, [labels, counts, safeBonusData]);

  const options: ChartOptions<'line'> = useMemo(() => {
    // Y-axis max: the next power of 10 at or above maxCount.
    const yAxisMax = maxCount > 1 ? Math.pow(10, Math.ceil(Math.log10(maxCount))) : 1;

    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top' as const,
          labels: {
            color: chartTheme.textMuted,
            font: {
              size: 12,
            },
            padding: 12,
            usePointStyle: true,
          },
        },
        tooltip: {
          ...chartTooltip(chartTheme),
          callbacks: {
            title: (tooltipItems) => {
              const date = tooltipItems[0].label;
              return formatDate(date);
            },
            label: (context) => {
              const label = context.dataset.label || '';
              const count = context.parsed.y ?? 0;
              
              if (label === 'Map') {
                return `Map: ${count.toLocaleString()}`;
              } else if (label.startsWith('Bonus ')) {
                const bonusNum = label.replace('Bonus ', '');
                return `B ${bonusNum}: ${count.toLocaleString()}`;
              }
              return `${label}: ${count.toLocaleString()}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            // Grid line at each January; every 12th index aligns only if the series starts in Jan.
            color: (ctx) => {
              // Chart.js types don't expose the tick index.
              const ctxAny = ctx as { tick?: { index?: number } };
              const index = ctxAny.tick?.index;
              if (typeof index === 'number' && isJanuary(labels[index])) {
                return chartTheme.grid;
              }
              return 'transparent';
            },
          },
          ticks: {
            color: chartTheme.textMuted,
            font: {
              size: 12,
            },
            maxRotation: 45,
            minRotation: 45,
            autoSkip: false,
            callback: (value, index) => {
              // Chart.js passes the numeric index to the tick callback
              const date = chartData.labels[index];
              if (!date) return '';
              
              const parts = date.split('-');
              if (parts.length !== 3) return date;
              const year = parseInt(parts[0], 10);
              
              // Past ~24 months the months crowd, so label years only.
              if (labels.length > 24) {
                return isJanuary(date) ? year.toString() : '';
              }
              return formatDate(date);
            },
          },
        },
        y: {
          type: 'logarithmic',
          min: 1,
          max: yAxisMax,
          grid: {
            color: chartTheme.grid,
          },
          ticks: {
            color: chartTheme.textMuted,
            font: {
              size: 12,
            },
            // Major ticks only (powers of 10), to reduce overlap.
            source: 'auto',
            autoSkip: true,
            maxTicksLimit: 6,
            callback: (value) => {
              const rounded = Math.round(value as number);
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
  }, [chartData, labels, maxCount, chartTheme]);

  if (safeData.length === 0) {
    return <ChartEmptyState title="Completions Over Time" message="No completion data available" />;
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
