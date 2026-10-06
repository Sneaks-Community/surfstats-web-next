'use client';

import { useEffect, useMemo, useState } from 'react';
import { Chart } from 'react-chartjs-2';
import { Chart as ChartJS, Tooltip, type ChartOptions } from 'chart.js';
import {
  ChoroplethController,
  GeoFeature,
  ColorScale,
  ProjectionScale,
  topojson,
} from 'chartjs-chart-geo';
import type { Feature, FeatureCollection } from 'geojson';
import worldData from 'world-atlas/countries-110m.json';
import ChartEmptyState from '@/components/ChartEmptyState';

ChartJS.register(ChoroplethController, GeoFeature, ColorScale, ProjectionScale, Tooltip);

/** One country's tallies, keyed for matching against map features. */
export interface WorldReachDatum {
  /** Zero-padded ISO 3166-1 numeric code (matches TopoJSON feature ids). */
  numeric: string;
  name: string;
  players: number;
}

interface WorldReachChartProps {
  data: WorldReachDatum[];
}

// Read at runtime so colors follow the env theme and light/dark toggle; `fallback` during SSR.
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Ships as TopoJSON; converted to GeoJSON once.
const worldFeatures: Feature[] = (
  topojson.feature(
    worldData as unknown as Parameters<typeof topojson.feature>[0],
    (worldData as unknown as { objects: { countries: unknown } }).objects
      .countries as Parameters<typeof topojson.feature>[1]
  ) as FeatureCollection
).features;

/** Players-per-country choropleth on a single-hue sequential ramp from the theme primary, with an
 * HTML legend. TopCountriesList beside it is its accessible table view. */
export default function WorldReachChart({ data }: WorldReachChartProps) {
  // Recompute themed colors whenever the <html> class (theme) changes.
  const [themeVersion, setThemeVersion] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeVersion((v) => v + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const byNumeric = useMemo(() => {
    const m = new Map<string, WorldReachDatum>();
    for (const d of data) m.set(d.numeric, d);
    return m;
  }, [data]);

  // Per-feature player value + display meta, aligned to worldFeatures order.
  const { values, meta } = useMemo(() => {
    const values: number[] = [];
    const meta: Array<{ name: string; players: number }> = [];
    for (const f of worldFeatures) {
      const datum = f.id != null ? byNumeric.get(String(f.id)) : undefined;
      const name =
        datum?.name ??
        ((f.properties as { name?: string } | null)?.name ?? 'Unknown');
      values.push(datum?.players ?? 0);
      meta.push({ name, players: datum?.players ?? 0 });
    }
    return { values, meta };
  }, [byNumeric]);

  // Quantiles of the non-zero counts, so a few dominant countries don't flatten the color spread.
  const thresholds = useMemo(() => {
    const nz = values.filter((v) => v > 0).sort((a, b) => a - b);
    if (nz.length === 0) return [] as number[];
    const q = (p: number) => nz[Math.min(nz.length - 1, Math.floor(p * nz.length))];
    return [q(0.2), q(0.4), q(0.6), q(0.8)];
  }, [values]);

  const bucketIndex = useMemo(() => {
    return (v: number): number => {
      if (v <= 0) return -1;
      let i = 0;
      while (i < thresholds.length && v > thresholds[i]) i++;
      return i;
    };
  }, [thresholds]);

  // Five steps, fewest to most, flipped per mode so the busiest countries stand out: darker on
  // light, brighter on dark. Fallbacks are the default emerald theme.
  const { ramp, emptyColor, borderColor } = useMemo(() => {
    const isLight =
      typeof document !== 'undefined' &&
      document.documentElement.classList.contains('light');

    const lightStops: Array<[string, string]> = [
      ['--color-primary-400', '#34d399'],
      ['--color-primary-500', '#10b981'],
      ['--color-primary-600', '#059669'],
      ['--color-primary-700', '#047857'],
      ['--color-primary-900', '#064e3b'],
    ];
    const darkStops: Array<[string, string]> = [
      ['--color-primary-700', '#047857'],
      ['--color-primary-600', '#059669'],
      ['--color-primary-500', '#10b981'],
      ['--color-primary-400', '#34d399'],
      ['--color-primary-200', '#a7f3d0'],
    ];
    const stops = isLight ? lightStops : darkStops;

    return {
      ramp: stops.map(([name, fallback]) => cssVar(name, fallback)),
      // Gray distinct from the surface in both modes (surface-hover is near-white on light).
      emptyColor: isLight ? '#d4d4d8' : '#3f3f46',
      // Mid gray that outlines every country, empty ones included, on either surface.
      borderColor: isLight ? '#9ca3af' : '#52525b',
    };
    // themeVersion is only a recompute trigger, not an input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeVersion]);

  const backgroundColors = useMemo(
    () => values.map((v) => (bucketIndex(v) < 0 ? emptyColor : ramp[bucketIndex(v)])),
    [values, bucketIndex, ramp, emptyColor]
  );

  const chartData = useMemo(
    () => ({
      labels: meta.map((m) => m.name),
      datasets: [
        {
          label: 'Players by country',
          outline: worldFeatures,
          showOutline: true,
          outlineBorderColor: borderColor,
          outlineBorderWidth: 0.75,
          data: worldFeatures.map((feature, i) => ({ feature, value: values[i] })),
          backgroundColor: backgroundColors,
          borderColor,
          borderWidth: 0.75,
        },
      ],
    }),
    [meta, values, backgroundColors, borderColor]
  );

  const options: ChartOptions<'choropleth'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
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
          displayColors: false,
          titleFont: { size: 13, weight: 'bold' as const },
          bodyFont: { size: 12 },
          callbacks: {
            title: (items) => meta[items[0].dataIndex].name,
            label: (item) => {
              const m = meta[item.dataIndex];
              if (m.players <= 0) return 'No ranked players yet';
              return `${m.players.toLocaleString()} players`;
            },
          },
        },
      },
      scales: {
        projection: { axis: 'x', projection: 'naturalEarth1' },
        color: { axis: 'x', display: false },
      },
    }),
    [meta]
  );

  if (data.length === 0) {
    return <ChartEmptyState title="Global Reach" message="No country data available" />;
  }

  const hasBuckets = thresholds.length > 0;

  return (
    <div className="flex flex-col">
      {/* Fixed height: a responsive, maintainAspectRatio:false canvas in an unsized flex-1/h-full
          parent feeds back on itself and grows without bound. */}
      <div className="relative w-full h-[300px] sm:h-[420px]">
        <Chart type="choropleth" data={chartData} options={options} />
      </div>
      {hasBuckets && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-muted">
          <div className="flex items-center gap-2">
            <span>Fewer</span>
            <div className="flex">
              {ramp.map((c, i) => (
                <span
                  key={i}
                  className="h-3 w-6"
                  style={{ backgroundColor: c }}
                  aria-hidden
                />
              ))}
            </div>
            <span>More players</span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-6 border border-border"
              style={{ backgroundColor: emptyColor }}
              aria-hidden
            />
            <span>No ranked players</span>
          </div>
        </div>
      )}
    </div>
  );
}
