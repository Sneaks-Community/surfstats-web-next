'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Activity, Search, Menu, X } from 'lucide-react';
import { ThemeToggleCompact } from '@/components/ThemeToggle';

const navLinks = [
  { href: '/', label: 'Dashboard' },
  { href: '/players', label: 'Players' },
  { href: '/maps', label: 'Maps' },
  { href: '/servers', label: 'Servers' },
];

export function Navigation({ siteName }: { siteName: string }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  return (
    <nav className="bg-background-secondary border-b border-border sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo and desktop nav */}
          <div className="flex items-center">
            <Link href="/" className="flex-shrink-0 flex items-center gap-2">
              <Activity className="h-8 w-8 text-primary" />
              <span className="text-text font-bold text-xl tracking-tight">{siteName}</span>
            </Link>
            <div className="hidden md:block ml-10">
              <div className="flex items-baseline space-x-4">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={pathname === link.href ? 'page' : undefined}
                    className="text-text-muted hover:bg-surface-hover hover:text-text px-3 py-2 rounded-md text-sm font-medium transition-colors"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* Desktop search and theme toggle */}
          <div className="hidden md:flex items-center gap-4">
            <form action="/search" method="GET" className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-text-placeholder" />
              </div>
              <input
                type="text"
                name="q"
                aria-label="Search players or maps"
                className="block w-full pl-10 pr-3 py-2 border border-border rounded-md leading-5 bg-surface text-text placeholder-text-placeholder focus:outline-none focus:bg-background-secondary focus:border-border-focus focus:ring-1 focus:ring-border-focus sm:text-sm transition-colors"
                placeholder="Search players or maps..."
              />
            </form>
            <ThemeToggleCompact />
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center gap-2">
            <ThemeToggleCompact />
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="text-text-muted hover:text-text p-2 rounded-md transition-colors"
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? (
                <X className="h-6 w-6" />
              ) : (
                <Menu className="h-6 w-6" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-border bg-background-secondary">
          <div className="px-4 py-4 space-y-4">
            {/* Mobile nav links */}
            <div className="flex flex-col space-y-2">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-text-muted hover:bg-surface-hover hover:text-text px-3 py-2 rounded-md text-base font-medium transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </div>
            {/* Mobile search */}
            <form action="/search" method="GET" className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-text-placeholder" />
              </div>
              <input
                type="text"
                name="q"
                aria-label="Search players or maps"
                className="block w-full pl-10 pr-3 py-2 border border-border rounded-md leading-5 bg-surface text-text placeholder-text-placeholder focus:outline-none focus:bg-background-secondary focus:border-border-focus focus:ring-1 focus:ring-border-focus sm:text-sm transition-colors"
                placeholder="Search players or maps..."
              />
            </form>
          </div>
        </div>
      )}
    </nav>
  );
}