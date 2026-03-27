'use client';

import { Area, AreaChart, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useMemo } from 'react';

interface PerformanceData {
  date: string;
  avgTime: number;
  mapCount: number;
  tier: number;
}

interface PerformanceTrendChartProps {
  data: PerformanceData[];
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
    value?: number;
    dataKey?: string;
    payload?: {
      date: string;
      [key: string]: any;
    };
  }>;
}

const CustomTooltip = ({ active, payload }: TooltipProps) => {
  if (active && payload && payload.length) {
    const dataPayload = payload[0].payload;
    if (!dataPayload) return null;
    
    const avgTime = payload[0].value ?? dataPayload.avgTime ?? 0;
    
    // Extract tier from dataKey (e.g., "tier_1" -> 1)
    const dataKey = payload[0].dataKey as string;
    const tierMatch = dataKey?.match(/tier_(\d+)/);
    const tier = tierMatch ? parseInt(tierMatch[1], 10) : 1;
    
    // Calculate hours, minutes, seconds
    const hours = Math.floor(avgTime / 3600);
    const minutes = Math.floor((avgTime % 3600) / 60);
    const seconds = Math.round(avgTime % 60);
    
    // Get map count from the original data (stored in the date key)
    const mapCount = dataPayload.mapCount ?? 1;
    
    const color = TIER_COLORS[tier] || DEFAULT_COLOR;
    
    return (
      <div className="bg-surface border border-border rounded-lg p-3 shadow-lg">
        <p className="font-semibold text-text">{new Date(dataPayload.date).toLocaleDateString()}</p>
        <p className="text-sm text-text-muted">
          Avg time: {hours > 0 ? `${hours}h ` : ''}{minutes}m {seconds}s
        </p>
        <p className="text-sm text-text-muted">
          Maps completed: <span className="text-text">{mapCount}</span>
        </p>
        <p className="text-sm text-text-muted">
          Tier: <span className="text-text" style={{ color }}>T{tier}</span>
        </p>
      </div>
    );
  }
  return null;
};

export default function PerformanceTrendChart({ data }: PerformanceTrendChartProps) {
  // Get unique tiers for legend and colors
  const tiers = useMemo(() => {
    return Array.from(new Set(data.map(d => d.tier))).sort((a, b) => a - b);
  }, [data]);

  // Restructure data for Recharts - each row has date and separate columns per tier
  const chartData = useMemo(() => {
    // Get all unique dates sorted
    const dates = Array.from(new Set(data.map(d => d.date))).sort();
    
    // Create data array with date, avgTime for each tier, and metadata
    return dates.map(date => {
      const row: any = { date };
      let totalMapCount = 0;
      
      tiers.forEach(tier => {
        const entry = data.find(d => d.date === date && d.tier === tier);
        row[`tier_${tier}`] = entry ? entry.avgTime : null;
        if (entry) {
          totalMapCount += entry.mapCount;
        }
      });
      
      // Store metadata for tooltip
      row.mapCount = totalMapCount;
      return row;
    });
  }, [data, tiers]);

  // If no data, show empty state
  if (chartData.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
        <h3 className="text-sm font-semibold text-text mb-2">Performance Trend</h3>
        <div className="flex-1 min-h-[200px] flex items-center justify-center text-text-muted text-sm">
          No completion history
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
      <h3 className="text-sm font-semibold text-text mb-2">Performance Trend</h3>
      <div className="flex-1 min-h-[200px]">
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              {tiers.map((tier) => (
                <linearGradient key={`gradient-${tier}`} id={`color-${tier}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={TIER_COLORS[tier] || DEFAULT_COLOR} stopOpacity={0.8} />
                  <stop offset="95%" stopColor={TIER_COLORS[tier] || DEFAULT_COLOR} stopOpacity={0.1} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis 
              dataKey="date" 
              stroke="var(--color-text-muted)"
              tick={{ fontSize: 12 }}
              tickFormatter={(value) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            />
            <YAxis 
              stroke="var(--color-text-muted)"
              tick={{ fontSize: 12 }}
              tickFormatter={(value) => {
                const hours = Math.floor(value / 3600);
                const minutes = Math.floor((value % 3600) / 60);
                return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
              }}
            />
            <Tooltip 
              content={<CustomTooltip />}
              labelFormatter={(label) => new Date(label).toLocaleDateString()}
            />
            {tiers.length > 1 && (
              <Legend 
                wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
              />
            )}
            {tiers.map((tier) => (
              <Area
                key={`area-${tier}`}
                type="monotone"
                dataKey={`tier_${tier}`}
                name={`Tier ${tier}`}
                stroke={TIER_COLORS[tier] || DEFAULT_COLOR}
                fill={`url(#color-${tier})`}
                strokeWidth={2}
                dot={false}
                connectNulls={true}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
