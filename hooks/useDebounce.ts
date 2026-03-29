'use client';

import { useState, useEffect } from 'react';

/**
 * useDebounce - A custom hook that debounces a value.
 * 
 * This hook returns a debounced version of the input value, which updates
 * after the specified delay has passed since the last change.
 * 
 * @template T - The type of the value being debounced
 * @param {T} value - The value to debounce
 * @param {number} delay - The delay in milliseconds before the value updates
 * @returns {T} The debounced value
 * 
 * @example
 * ```typescript
 * const [search, setSearch] = useState('');
 * const debouncedSearch = useDebounce(search, 300);
 * ```
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}
