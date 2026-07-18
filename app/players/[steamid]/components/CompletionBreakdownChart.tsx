'use client';

import { Doughnut } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { useMemo, useState } from 'react';

ChartJS.register(ArcElement, Tooltip, Legend);

interface CompletionBreakdownChartProps {
  counts: {
    maps: number;
    bonuses: number;
    stages: number;
  };
}

// Categorical palette validated for CVD safety (dataviz skill: blue / green /
// magenta, ΔE well above the colorblind floor in both light and dark). Identity
// is reinforced by the legend + center total, so it never rests on color alone.
const SEGMENTS = [
  { label: 'Maps', color: '#3987e5' },
  { label: 'Bonuses', color: '#008300' },
  { label: 'Stages', color: '#d55181' },
] as const;

export default function CompletionBreakdownChart({ counts }: CompletionBreakdownChartProps) {
  const values = useMemo(
    () => [counts.maps, counts.bonuses, counts.stages],
    [counts.maps, counts.bonuses, counts.stages]
  );

  const total = values.reduce((sum, v) => sum + v, 0);

  // The center total is an HTML overlay stacked above the canvas, so it would
  // show through the (canvas-drawn) tooltip. Fade it out while a segment is
  // hovered so the tooltip stays legible.
  const [hovering, setHovering] = useState(false);

  const chartData = useMemo(
    () => ({
      labels: SEGMENTS.map((s) => s.label),
      datasets: [
        {
          data: values,
          backgroundColor: SEGMENTS.map((s) => s.color),
          // 2px surface gap between segments (dataviz mark spec).
          borderColor: 'rgba(30, 41, 59, 0)',
          borderWidth: 2,
          hoverOffset: 4,
        },
      ],
    }),
    [values]
  );

  const options: ChartOptions<'doughnut'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      onHover: (_event, elements) => {
        setHovering(elements.length > 0);
      },
      plugins: {
        legend: {
          display: true,
          position: 'bottom' as const,
          labels: {
            usePointStyle: true,
            boxWidth: 8,
            boxHeight: 8,
            padding: 12,
            font: { size: 11 },
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
          titleFont: { size: 13, weight: 'bold' as const },
          bodyFont: { size: 12 },
          callbacks: {
            label: (context) => {
              const value = context.parsed;
              const pct = total > 0 ? (value / total) * 100 : 0;
              return `${context.label}: ${value.toLocaleString()} (${pct.toFixed(1)}%)`;
            },
          },
        },
      },
    }),
    [total]
  );

  return (
    <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
      <h3 className="text-sm font-semibold text-text mb-2">Completion Breakdown</h3>
      <div className="flex-1 min-h-[200px] relative">
        <Doughnut data={chartData} options={options} />
        {/* Center total overlays the doughnut hole; fades out on hover so it
            never bleeds through the tooltip. */}
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center pointer-events-none -translate-y-[10%] transition-opacity duration-150 ${
            hovering ? 'opacity-0' : 'opacity-100'
          }`}
        >
          <span className="text-2xl font-bold text-text leading-none">{total.toLocaleString()}</span>
          <span className="text-xs text-text-muted mt-1">Total</span>
        </div>
      </div>
    </div>
  );
}
