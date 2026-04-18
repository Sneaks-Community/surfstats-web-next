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
  Filler,
);

interface WRPerformanceData {
  mapname: string;
  wrPercentage: number; // percentage of WR time (higher is better)
  tier: number;
  date: string;
}

interface AggregatedDataPoint {
  date: string;
  avgWR: number;
  count: number;
}

interface WRPerformanceChartProps {
  data: WRPerformanceData[];
}

/**
 * Determine aggregation granularity based on time range
 */
type AggregationGranularity = 'day' | 'week' | 'month' | 'quarter';

const getGranularity = (earliestDate: Date, latestDate: Date): AggregationGranularity => {
  const timeRangeMs = latestDate.getTime() - earliestDate.getTime();
  const days = timeRangeMs / (1000 * 60 * 60 * 24);
  
  if (days <= 90) return 'day';
  if (days <= 365) return 'week';
  if (days <= 1095) return 'month'; // 3 years
  return 'quarter';
};

/**
 * Format date based on granularity
 */
const formatDateLabel = (dateInput: string | Date, granularity: AggregationGranularity): string => {
  let date: Date;
  if (dateInput instanceof Date) {
    date = dateInput;
  } else {
    date = new Date(dateInput);
  }
  if (isNaN(date.getTime())) return String(dateInput);
  
  switch (granularity) {
    case 'day':
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    case 'week':
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    case 'month':
      return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    case 'quarter':
      return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
};

/**
 * Get color based on WR percentage
 */
const getPointColor = (wrPercentage: number): string => {
  if (wrPercentage >= 95) return 'rgba(34, 197, 94, 1)';   // green-500
  if (wrPercentage >= 85) return 'rgba(234, 179, 8, 1)';   // yellow-500
  return 'rgba(239, 68, 68, 1)';                            // red-500
};

/**
 * Get moving average window size based on granularity
 */
const getMovingAvgWindowSize = (granularity: AggregationGranularity): number => {
  switch (granularity) {
    case 'day': return 7;
    case 'week': return 4;
    case 'month': return 3;
    case 'quarter': return 2;
  }
};

export default function WRPerformanceChart({ data }: WRPerformanceChartProps) {
  const safeData = useMemo(() => {
    if (!Array.isArray(data)) return [];
    // Sort by date ascending (oldest first)
    return [...data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [data]);

  // Determine granularity and aggregate data
  const { granularity, aggregatedData } = useMemo(() => {
    if (safeData.length === 0) {
      return { granularity: 'day' as AggregationGranularity, aggregatedData: [] as AggregatedDataPoint[], earliestDate: null as Date | null, latestDate: null as Date | null };
    }
    
    const earliest = new Date(safeData[0].date);
    const latest = new Date(safeData[safeData.length - 1].date);
    const gran = getGranularity(earliest, latest);
    
    // Aggregate based on granularity
    const dataMap = new Map<string, { total: number; count: number }>();
    
    for (const d of safeData) {
      const dateValue = d.date as unknown as Date | string;
      let date: Date;
      if (dateValue instanceof Date) {
        date = dateValue;
      } else {
        date = new Date(dateValue);
      }
      
      let key: string;
      switch (gran) {
        case 'day':
          key = date.toISOString().split('T')[0];
          break;
        case 'week': {
          // Get start of week (Monday)
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay() + 1);
          key = weekStart.toISOString().split('T')[0];
          break;
        }
        case 'month':
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          break;
        case 'quarter': {
          const quarter = Math.floor(date.getMonth() / 3);
          key = `${date.getFullYear()}-Q${quarter + 1}`;
          break;
        }
      }
      
      const current = dataMap.get(key) || { total: 0, count: 0 };
      current.total += d.wrPercentage;
      current.count += 1;
      dataMap.set(key, current);
    }
    
    // Convert to array and sort by date
    const result: AggregatedDataPoint[] = [];
    for (const [key, { total, count }] of dataMap) {
      result.push({ date: key, avgWR: total / count, count });
    }
    result.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    return { granularity: gran, aggregatedData: result, earliestDate: earliest, latestDate: latest };
  }, [safeData]);

  // Calculate moving average
  const movingAvg = useMemo(() => {
    if (aggregatedData.length === 0) return [];
    const windowSize = getMovingAvgWindowSize(granularity);
    
    const result: number[] = [];
    for (let i = 0; i < aggregatedData.length; i++) {
      const start = Math.max(0, i - windowSize + 1);
      const window = aggregatedData.slice(start, i + 1);
      const avg = window.reduce((sum, d) => sum + d.avgWR, 0) / window.length;
      result.push(avg);
    }
    return result;
  }, [aggregatedData, granularity]);

  const chartData = useMemo(() => {
    if (aggregatedData.length === 0) {
      return null;
    }

    return {
      labels: aggregatedData.map(d => formatDateLabel(d.date, granularity)),
      datasets: [
        {
          label: 'WR %',
          data: aggregatedData.map(d => Math.min(d.avgWR, 100)),
          borderColor: 'rgba(59, 130, 246, 0.8)', // blue-500
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          borderWidth: 2,
          pointRadius: aggregatedData.length > 30 ? 0 : 3,
          pointHoverRadius: 5,
          pointBackgroundColor: aggregatedData.map(d => getPointColor(Math.min(d.avgWR, 100))),
          pointBorderColor: '#fff',
          pointBorderWidth: 1,
          tension: 0.3,
          fill: true,
        },
        {
          label: `${granularity === 'day' ? '7-Day' : granularity === 'week' ? '4-Week' : granularity === 'month' ? '3-Month' : '2-Quarter'} Avg`,
          data: movingAvg,
          borderColor: 'rgba(239, 68, 68, 0.6)', // red-500
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.4,
          borderDash: [5, 5],
          fill: false,
        },
      ],
    };
  }, [aggregatedData, granularity, movingAvg]);

  const options: ChartOptions<'line'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        labels: {
          usePointStyle: true,
          boxWidth: 8,
          boxHeight: 8,
          font: {
            size: 11,
          },
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
        titleFont: {
          size: 13,
          weight: 'bold' as const,
        },
        bodyFont: {
          size: 12,
        },
        callbacks: {
          title: (tooltipItems) => {
            return tooltipItems[0].label || '';
          },
          label: (context) => {
            const value = context.parsed.y as number;
            const datasetLabel = context.dataset.label;
            return `${datasetLabel}: ${value.toFixed(1)}%`;
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
            size: 10,
          },
          maxTicksLimit: 8,
          maxRotation: 0,
        },
      },
      y: {
        min: 50,
        max: 100,
        grid: {
          color: 'rgba(148, 163, 184, 0.15)',
        },
        ticks: {
          color: '#94a3b8',
          font: {
            size: 11,
          },
          callback: (value) => `${value}%`,
          stepSize: 10,
        },
      },
    },
  }), []);

  // Calculate summary stats
  const summaryStats = useMemo(() => {
    if (aggregatedData.length === 0) return null;
    const avgWR = aggregatedData.reduce((sum, d) => sum + d.avgWR, 0) / aggregatedData.length;
    const bestWR = Math.max(...aggregatedData.map(d => d.avgWR));
    const worstWR = Math.min(...aggregatedData.map(d => d.avgWR));
    const latestWR = aggregatedData[aggregatedData.length - 1]?.avgWR || 0;
    
    // Calculate trend (compare first half avg to second half avg)
    const midPoint = Math.floor(aggregatedData.length / 2);
    const firstHalf = aggregatedData.slice(0, midPoint);
    const secondHalf = aggregatedData.slice(midPoint);
    const firstHalfAvg = firstHalf.reduce((sum, d) => sum + d.avgWR, 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((sum, d) => sum + d.avgWR, 0) / secondHalf.length;
    const trend = secondHalfAvg - firstHalfAvg;
    
    return { avgWR, bestWR, worstWR, latestWR, trend, total: aggregatedData.length };
  }, [aggregatedData]);

  if (chartData === null) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
        <h3 className="text-sm font-semibold text-text mb-2">Completion Percentile</h3>
        <div className="flex-1 min-h-[200px] flex items-center justify-center text-text-muted text-sm">
          No completions
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text">Completion Percentile</h3>
        {summaryStats && (
          <div className="flex items-center gap-3 text-xs text-text-muted">
            <span>Avg: <span className="text-text font-medium">{summaryStats.avgWR.toFixed(1)}%</span></span>
            <span>Best: <span className="text-text font-medium">{summaryStats.bestWR.toFixed(1)}%</span></span>
            <span>Trend: <span className={`font-medium ${summaryStats.trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {summaryStats.trend >= 0 ? '↑' : '↓'} {Math.abs(summaryStats.trend).toFixed(1)}%
            </span></span>
          </div>
        )}
      </div>
      <div className="flex-1 min-h-[200px]">
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
}
