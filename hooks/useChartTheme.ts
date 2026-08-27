'use client';

import { useEffect, useMemo, useState } from 'react';

// Used during SSR and if a property is missing; matches the dark palette the
// charts were written against.
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

/**
 * Chart.js draws to canvas, so it can't use CSS classes: colors have to be
 * resolved to strings. Reads them from the theme's custom properties and
 * recomputes when the light/dark class on <html> flips.
 */
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
