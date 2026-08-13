'use client';

import { useMemo } from 'react';
import ChartEmptyState from '@/components/ChartEmptyState';
import { HEATMAP_MAX_SESSIONS } from '@/lib/utils';
import { useDisplayTz } from '@/lib/ClientConfigContext';

interface HeatmapDataPoint {
  dayOfWeek: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  hour: number;      // 0-23
  count: number;
}

interface ActivityHeatmapChartProps {
  data: HeatmapDataPoint[];
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_FULL_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Format hour to 12-hour format with AM/PM
 */
const formatHour = (hour: number): string => {
  if (hour === 0) return '12am';
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return '12pm';
  return `${hour - 12}pm`;
};

/**
 * Get cell color based on count intensity using blue-to-red diverging palette
 * Blue = low activity, Red = high activity
 */
const getCellColor = (count: number, maxCount: number): string => {
  if (maxCount === 0 || count === 0) return 'rgba(219, 234, 254, 0.3)'; // blue-50 very light
  
  const intensity = count / maxCount;
  
  // Blue (low) → Light Blue → Sky → White → Light Pink → Pink → Red (high)
  if (intensity < 0.1) return 'rgba(219, 234, 254, 0.5)';   // blue-50
  if (intensity < 0.2) return 'rgba(191, 219, 254, 0.6)';   // blue-100
  if (intensity < 0.3) return 'rgba(147, 197, 253, 0.7)';   // blue-200
  if (intensity < 0.4) return 'rgba(96, 165, 250, 0.75)';   // blue-300
  if (intensity < 0.5) return 'rgba(59, 130, 246, 0.8)';    // blue-500
  if (intensity < 0.6) return 'rgba(236, 72, 153, 0.6)';    // pink-500
  if (intensity < 0.7) return 'rgba(236, 72, 153, 0.75)';   // pink-500
  if (intensity < 0.8) return 'rgba(239, 68, 68, 0.7)';     // red-500
  if (intensity < 0.9) return 'rgba(239, 68, 68, 0.85)';    // red-500
  return 'rgba(185, 28, 28, 0.95)';                          // red-700
};

export default function ActivityHeatmapChart({ data }: ActivityHeatmapChartProps) {
  const displayTz = useDisplayTz();
  const safeData = useMemo(() => Array.isArray(data) ? data : [], [data]);

  const heatmapGrid = useMemo(() => {
    // Create 7x24 grid
    const grid: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    
    let maxCount = 0;
    for (const point of safeData) {
      grid[point.dayOfWeek][point.hour] = point.count;
      if (point.count > maxCount) {
        maxCount = point.count;
      }
    }

    return { grid, maxCount };
  }, [safeData]);

  const peakTime = useMemo(() => {
    if (safeData.length === 0) return null;
    const peak = safeData.reduce((max, d) => d.count > max.count ? d : max, safeData[0]);
    return {
      day: DAY_NAMES[peak.dayOfWeek],
      dayFull: DAY_FULL_NAMES[peak.dayOfWeek],
      hour: formatHour(peak.hour),
      count: peak.count,
    };
  }, [safeData]);

  if (safeData.length === 0) {
    return <ChartEmptyState title="Activity Heatmap" message="No connection data" />;
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 h-full flex flex-col">
      <div className="flex items-start justify-between mb-3 gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text">Activity Heatmap</h3>
          {/* The query keeps only the newest N connections, so say so rather than
              presenting a truncated history as the whole of it. */}
          <p className="text-xs text-text-muted">
            Last {HEATMAP_MAX_SESSIONS.toLocaleString()} sessions • times in {displayTz}
          </p>
        </div>
        {peakTime && (
          <div className="flex items-center gap-3 text-xs text-text-muted whitespace-nowrap">
            <span>Peak: <span className="text-text font-medium">{peakTime.day} {peakTime.hour}</span></span>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-[200px]">
        {/* Main grid container */}
        <div className="flex" style={{ height: 'calc(100% - 30px)' }}>
          {/* Day labels column - aligned with heatmap rows */}
          <div className="flex flex-col pr-2">
            {DAY_NAMES.map((day) => (
              <div
                key={day}
                className="text-xs text-text-muted flex items-center justify-end flex-1"
              >
                {day}
              </div>
            ))}
          </div>
          
          {/* Heatmap grid */}
          <div className="flex-1 flex flex-col">
            {/* Hour labels row */}
            <div className="flex mb-1">
              {Array.from({ length: 24 }, (_, i) => (
                <div
                  key={i}
                  className="flex-1 text-[10px] text-text-muted text-center"
                >
                  {i % 2 === 0 ? formatHour(i) : ''}
                </div>
              ))}
            </div>
            {/* Grid cells - one row per day */}
            <div className="flex flex-col flex-1">
              {Array.from({ length: 7 }, (_, day) => (
                <div key={day} className="flex flex-1">
                  {Array.from({ length: 24 }, (_, hour) => {
                    const count = heatmapGrid.grid[day][hour];
                    const label = `${DAY_FULL_NAMES[day]} ${formatHour(hour)}: ${count} ${count === 1 ? 'connection' : 'connections'}`;
                    return (
                      <div
                        key={hour}
                        role="img"
                        title={label}
                        aria-label={label}
                        className="flex-1 transition-opacity hover:opacity-80 cursor-default"
                        style={{
                          backgroundColor: getCellColor(count, heatmapGrid.maxCount),
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
        
      </div>
    </div>
  );
}
