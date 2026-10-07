'use client';

import { useEffect, useMemo, useState } from 'react';

// SSR and missing-property fallback; matches the dark palette.
const FALLBACK = {
  text: '#f8fafc',
  textMuted: '#94a3b8',
  border: 'rgba(148, 163, 184, 0.5)',
  grid: 'rgba(148, 163, 184, 0.15)',
  surface: 'rgba(30, 41, 59, 0.95)',
};

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export interface ChartTheme {
  text: string;
  textMuted: string;
  border: string;
  grid: string;
  surface: string;
}

/** Tooltip chrome every chart shares; spread it under `plugins.tooltip`. */
export const chartTooltip = (theme: ChartTheme) => ({
  backgroundColor: theme.surface,
  titleColor: theme.text,
  bodyColor: theme.textMuted,
  borderColor: theme.border,
  borderWidth: 1,
  cornerRadius: 8,
  padding: 12,
  titleFont: { size: 13, weight: 'bold' as const },
  bodyFont: { size: 12 },
});

/** Theme colors as strings, since Chart.js draws to canvas and can't use CSS classes. Read from the
 * theme's CSS custom properties; recomputed when the light/dark class on <html> flips. */
export function useChartTheme(): ChartTheme {
  const [themeVersion, setThemeVersion] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeVersion((v) => v + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return useMemo(
    () => ({
      text: cssVar('--color-text', FALLBACK.text),
      textMuted: cssVar('--color-text-muted', FALLBACK.textMuted),
      border: cssVar('--color-border', FALLBACK.border),
      grid: cssVar('--color-border', FALLBACK.grid),
      surface: cssVar('--color-surface', FALLBACK.surface),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- themeVersion is the re-read trigger, not a value
    [themeVersion]
  );
}
