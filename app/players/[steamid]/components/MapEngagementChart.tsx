'use client';

import { Bubble } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { useMemo } from 'react';
import type { MapEngagementPoint } from '@/lib/player-analytics';

ChartJS.register(LinearScale, PointElement, Tooltip, Legend);

interface MapEngagementChartProps {
  data: MapEngagementPoint[];
}

const MIN_RADIUS = 6;
const MAX_RADIUS = 24;

const PALETTE = [
  '#3987e5', '#008300', '#d55181', '#c98500', '#199e70',
  '#d95926', '#9085e9', '#e66767',
];

export default function MapEngagementChart({ data }: MapEngagementChartProps) {
  const chartData = useMemo(() => {
    const maxAvg = Math.max(...data.map((d) => d.avgMinutes), 1);
    return {
      datasets: data.map((d, i) => {
        const hue = PALETTE[i % PALETTE.length];
        return {
          label: d.map,
          data: [
            {
              x: d.sessions,
              y: d.hours,
              r: MIN_RADIUS + (d.avgMinutes / maxAvg) * (MAX_RADIUS - MIN_RADIUS),
            },
          ],
          backgroundColor: `${hue}8c`,
          borderColor: hue,
          borderWidth: 1.5,
        };
      }),
    };
  }, [data]);

  const avgByMap = useMemo(() => new Map(data.map((d) => [d.map, d.avgMinutes])), [data]);

  const options: ChartOptions<'bubble'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: 8 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(30, 41, 59, 0.95)',
          titleColor: '#f8fafc',
          bodyColor: '#e2e8f0',
          borderColor: 'rgba(148, 163, 184, 0.5)',
          borderWidth: 1,
          cornerRadius: 8,
          padding: 12,
          titleFont: { size: 13, weight: 'bold' as const },
          bodyFont: { size: 12 },
          callbacks: {
            title: (items) => items[0]?.dataset.label ?? '',
            label: (ctx) => {
              const point = ctx.parsed as { x: number; y: number };
              const avg = avgByMap.get(ctx.dataset.label ?? '') ?? 0;
              return [
                `Sessions: ${point.x}`,
                `Hours: ${point.y.toFixed(1)}`,
                `Avg session: ${avg.toFixed(0)} min`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: 'Sessions', color: '#94a3b8', font: { size: 11 } },
          beginAtZero: true,
          grid: { color: 'rgba(148, 163, 184, 0.15)' },
          ticks: { color: '#94a3b8', font: { size: 10 }, precision: 0 },
        },
        y: {
          title: { display: true, text: 'Hours', color: '#94a3b8', font: { size: 11 } },
          beginAtZero: true,
          grid: { color: 'rgba(148, 163, 184, 0.15)' },
          ticks: { color: '#94a3b8', font: { size: 10 } },
        },
      },
    }),
    [avgByMap]
  );

  return (
    <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
      <h3 className="text-sm font-semibold text-text mb-2">Map Engagement</h3>
      <div className="flex-1 min-h-[200px]">
        <Bubble data={chartData} options={options} />
      </div>
    </div>
  );
}
