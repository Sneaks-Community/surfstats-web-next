'use client';

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = 'theme';
// Same-tab notification: 'storage' events only fire in *other* tabs, so we emit
// our own event when this tab writes the theme.
const THEME_CHANGE_EVENT = 'themechange';

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

/**
 * Get the system preference for color scheme
 */
function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Read the persisted theme from localStorage (client snapshot for the store).
 */
function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Subscribe to theme changes from other tabs ('storage') and this tab
 * (our custom event dispatched by setTheme).
 */
function subscribe(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(THEME_CHANGE_EVENT, callback);
  };
}

/**
 * Apply the resolved (light/dark) theme to the document element.
 */
function applyResolvedTheme(theme: Theme): void {
  const root = document.documentElement;
  const resolved = theme === 'system' ? getSystemTheme() : theme;
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
}

/**
 * ThemeProvider component
 * Wraps the application to provide theme context
 */
export function ThemeProvider({
  children,
  defaultTheme = 'system',
}: {
  children: React.ReactNode;
  defaultTheme?: Theme;
}) {
  // localStorage is a client-only external store. useSyncExternalStore renders
  // the server snapshot (defaultTheme) during SSR *and* hydration so the markup
  // matches (no hydration mismatch / React #418), then switches to the stored
  // value on the client without a mismatch error. This keeps every consumer
  // (e.g. the theme toggle icon) hydration-safe.
  const theme = useSyncExternalStore(subscribe, getStoredTheme, () => defaultTheme);

  const setTheme = useCallback((newTheme: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, newTheme);
    } catch {
      // Ignore write failures (e.g. private mode); the in-memory value below still updates.
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  // Keep the <html> class in sync with the resolved theme. Runs for every theme
  // (including 'system'), so React authoritatively manages the class.
  useEffect(() => {
    applyResolvedTheme(theme);
  }, [theme]);

  // Follow OS changes while in 'system' mode.
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => applyResolvedTheme('system');

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Hook to access theme context
 * Must be used within a ThemeProvider
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
