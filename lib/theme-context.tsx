'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = 'theme';

/**
 * Get the system preference for color scheme
 */
function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Get initial theme from localStorage (for lazy initialization)
 */
function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
  return stored && ['light', 'dark', 'system'].includes(stored) ? stored : 'system';
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
  // Use lazy initialization for theme state to read from localStorage once
  const [theme, setThemeState] = useState<Theme>(() => {
    // This runs only on client during initial render
    if (typeof window !== 'undefined') {
      return getInitialTheme();
    }
    return defaultTheme;
  });

  // Apply theme to DOM whenever it changes
  useEffect(() => {
    const root = document.documentElement;
    const newResolved = theme === 'system' ? getSystemTheme() : theme;
    
    root.classList.remove('light', 'dark');
    root.classList.add(newResolved);
    root.style.colorScheme = newResolved;
  }, [theme]);

  // Listen for system theme changes when theme is 'system'
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleChange = () => {
      const newResolved = getSystemTheme();
      const root = document.documentElement;
      root.classList.remove('light', 'dark');
      root.classList.add(newResolved);
      root.style.colorScheme = newResolved;
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);
  }, []);

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