'use client';

import { Pie, PieChart, Cell, ResponsiveContainer, Tooltip, Legend, PieLabelRenderProps } from 'recharts';
import { useMemo } from 'react';

interface TierData {
  tier: number;
  completed_maps: number;
  total_maps: number;
}

interface TierDistributionChartProps {
  data: TierData[];
}

// Tier colors matching the existing tierColors.ts theme
const TIER_COLORS: Record<number, string> = {
  1: '#10b981', // emerald-500
  2: '#84cc16', // lime-500
  3: '#eab308', // yellow-500
  4: '#f97316', // orange-500
  5: '#ea580c', // orange-600
  6: '#ef4444', // red-500
  7: '#e11d48', // rose-600
  8: '#db2777', // pink-600
  9: '#a855f7', // purple-500
  10: '#7c3aed', // violet-600
};

const DEFAULT_COLOR = '#ef4444'; // red-500 for tiers > 10

// Custom tooltip component
interface TooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: {
      tier: number;
      completed: number;
      total: number;
      percentage: number;
      fill: string;
    };
  }>;
}

const CustomTooltip = ({ active, payload }: TooltipProps) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-surface border border-border rounded-lg p-3 shadow-lg">
        <p className="font-semibold text-text">Tier {data.tier}</p>
        <p className="text-sm text-text-muted">
          <span className="text-text">{data.completed}</span> of <span className="text-text">{data.total}</span> maps
        </p>
        <p className="text-sm text-text-muted">
          <span className="font-medium" style={{ color: data.fill }}>
            {data.percentage.toFixed(1)}%
          </span>
          {' '}completion
        </p>
      </div>
    );
  }
  return null;
};

// Custom legend component
interface LegendProps {
  payload?: Array<{
    value: string;
    type: string;
    color: string;
  }>;
}

const CustomLegend = ({ payload }: LegendProps) => {
  if (!payload) return null;
  
  return (
    <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-1">
      {payload.map((entry, index) => (
        <div key={`legend-${index}`} className="flex items-center gap-1 text-xs">
          <div
            className="w-2 h-2 rounded-sm flex-shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-text-muted">{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

// Label renderer for pie slices
const renderLabel = (props: PieLabelRenderProps) => {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent, name } = props;
  
  // Type guard to ensure we have valid numbers
  if (
    typeof cx !== 'number' ||
    typeof cy !== 'number' ||
    typeof midAngle !== 'number' ||
    typeof innerRadius !== 'number' ||
    typeof outerRadius !== 'number' ||
    typeof percent !== 'number'
  ) {
    return null;
  }
  
  if (percent < 0.05) return null; // Don't show labels for slices < 5%
  
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  
  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor="middle"
      dominantBaseline="central"
      className="text-xs font-medium"
    >
      T{name}
    </text>
  );
};

export default function TierDistributionChart({ data }: TierDistributionChartProps) {
  // Transform data for the chart
  const chartData = useMemo(() => {
    return data
      .filter(d => d.completed_maps > 0) // Only show tiers with completions
      .map(d => ({
        tier: d.tier,
        completed: d.completed_maps,
        total: d.total_maps,
        percentage: d.total_maps > 0 ? (d.completed_maps / d.total_maps) * 100 : 0,
        fill: TIER_COLORS[d.tier] || DEFAULT_COLOR,
      }));
  }, [data]);

  // If no data, show empty state
  if (chartData.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
        <h3 className="text-sm font-semibold text-text mb-2">Tier Distribution</h3>
        <div className="flex-1 min-h-[200px] flex items-center justify-center text-text-muted text-sm">
          No completions
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
      <h3 className="text-sm font-semibold text-text mb-2">Tier Distribution</h3>
      <div className="flex-1 min-h-[200px]">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius="35%"
              outerRadius="70%"
              paddingAngle={2}
              dataKey="completed"
              nameKey="tier"
              labelLine={false}
              label={renderLabel}
            >
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.fill}
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend content={<CustomLegend />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}