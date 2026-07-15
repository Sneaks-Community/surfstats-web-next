'use client';

import { Moon, Sun, Monitor, ChevronDown } from 'lucide-react';
import { useTheme } from '@/lib/theme-context';
import { useState, useRef, useEffect } from 'react';

const themeOptions = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const;

/**
 * Theme toggle component with dropdown
 * Allows users to switch between light, dark, and system themes
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  const currentOption = themeOptions.find(opt => opt.value === theme) || themeOptions[2];
  const CurrentIcon = currentOption.icon;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-surface border border-border hover:bg-surface-hover transition-colors text-sm"
        aria-label="Select theme"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <CurrentIcon className="h-4 w-4 text-primary" />
        <ChevronDown className={`h-3 w-3 text-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-1 w-32 bg-surface border border-border rounded-md shadow-lg overflow-hidden z-50"
          role="listbox"
          aria-label="Theme options"
        >
          {themeOptions.map((option) => {
            const Icon = option.icon;
            const isSelected = theme === option.value;
            
            return (
              <button
                key={option.value}
                onClick={() => {
                  setTheme(option.value);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                  isSelected
                    ? 'bg-primary/10 text-primary'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text'
                }`}
                role="option"
                aria-selected={isSelected}
              >
                <Icon className="h-4 w-4" />
                <span>{option.label}</span>
                {isSelected && (
                  <span className="ml-auto text-primary">✓</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Compact theme toggle for mobile/navigation
 */
export function ThemeToggleCompact() {
  return <ThemeToggle />;
}