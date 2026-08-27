'use client';

import { Bar } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { useMemo } from 'react';
import ChartEmptyState from '@/components/ChartEmptyState';
import { useChartTheme } from '@/hooks/useChartTheme';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface TimelinePoint {
  tier: number;
  date: string;
}

interface CareerTimelineChartProps {
  data: TimelinePoint[];
}

type Granularity = 'month' | 'quarter' | 'year';

const MAX_BARS = 16;
const MIN_BARS = 4;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const TIER_COLORS: Record<number, string> = {
  1: '#10b981',
  2: '#84cc16',
  3: '#eab308',
  4: '#f97316',
  5: '#ea580c',
};
const tierColor = (tier: number): string => TIER_COLORS[tier] ?? '#ef4444';

const bucketIndex = (date: Date, gran: Granularity): number => {
  switch (gran) {
    case 'month':
      return date.getFullYear() * 12 + date.getMonth();
    case 'quarter':
      return date.getFullYear() * 4 + Math.floor(date.getMonth() / 3);
    case 'year':
      return date.getFullYear();
  }
};

const bucketLabel = (index: number, gran: Granularity): string => {
  switch (gran) {
    case 'month': {
      const year = Math.floor(index / 12);
      return `${MONTHS[index % 12]} '${String(year).slice(2)}`;
    }
    case 'quarter': {
      const year = Math.floor(index / 4);
      return `Q${(index % 4) + 1} '${String(year).slice(2)}`;
    }
    case 'year':
      return String(index);
  }
};

export default function CareerTimelineChart({ data }: CareerTimelineChartProps) {
  const chartTheme = useChartTheme();
  const { chartData, options } = useMemo(() => {
    const dated = data
      .map((d) => ({ tier: d.tier, date: new Date(d.date) }))
      .filter((d) => !isNaN(d.date.getTime()))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    if (dated.length === 0) return { chartData: null, options: null };

    const earliest = dated[0].date;
    const latest = dated[dated.length - 1].date;

    const gran: Granularity =
      (['month', 'quarter', 'year'] as const).find((g) => {
        const span = bucketIndex(latest, g) - bucketIndex(earliest, g) + 1;
        return span <= MAX_BARS;
      }) ?? 'year';

    let first = bucketIndex(earliest, gran);
    const last = bucketIndex(latest, gran);
    if (last - first + 1 < MIN_BARS) first = last - (MIN_BARS - 1);

    const bucketCount = last - first + 1;
    const tiers = [...new Set(dated.map((d) => d.tier))].sort((a, b) => a - b);

    const counts = new Map<number, number[]>();
    for (const t of tiers) counts.set(t, new Array<number>(bucketCount).fill(0));
    for (const d of dated) {
      const pos = bucketIndex(d.date, gran) - first;
      const arr = counts.get(d.tier);
      if (!arr || pos < 0 || pos >= bucketCount) continue;
      arr[pos] += 1;
    }

    const labels = Array.from({ length: bucketCount }, (_, i) => bucketLabel(first + i, gran));

    const chartData = {
      labels,
      datasets: tiers.map((t) => ({
        label: `Tier ${t}`,
        data: counts.get(t) ?? [],
        backgroundColor: tierColor(t),
        borderWidth: 0,
        stack: 'records',
        maxBarThickness: 48,
      })),
    };

    const options: ChartOptions<'bar'> = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index' as const, intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top' as const,
          labels: {
            usePointStyle: true,
            boxWidth: 8,
            boxHeight: 8,
            font: { size: 11 },
            color: chartTheme.textMuted,
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
          titleFont: { size: 13, weight: 'bold' as const },
          bodyFont: { size: 12 },
          filter: (item) => (item.parsed.y as number) > 0,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}`,
            footer: (items) => {
              const total = items.reduce((sum, i) => sum + (i.parsed.y as number), 0);
              return `Total: ${total}`;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { color: chartTheme.textMuted, font: { size: 10 }, maxRotation: 0, maxTicksLimit: 12 },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: chartTheme.grid },
          ticks: { color: chartTheme.textMuted, font: { size: 11 }, precision: 0 },
        },
      },
    };

    return { chartData, options };
  }, [data, chartTheme]);

  if (!chartData) {
    return <ChartEmptyState title="Career Timeline" message="No completions" />;
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
      <h3 className="text-sm font-semibold text-text mb-2">Career Timeline</h3>
      <div className="flex-1 min-h-[200px]">
        <Bar data={chartData} options={options} />
      </div>
    </div>
  );
}
