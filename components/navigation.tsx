'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Activity, Search, Menu, X, ChevronDown } from 'lucide-react';
import { ThemeToggleCompact } from '@/components/ThemeToggle';
import { SearchDropdown } from '@/components/SearchDropdown';

const navLinks = [
  { href: '/', label: 'Dashboard' },
  { 
    href: '/players', 
    label: 'Players',
    children: [
      { href: '/players', label: 'All Players' },
      { href: '/players/countries', label: 'Countries' },
    ]
  },
  { href: '/maps', label: 'Maps' },
  { href: '/servers', label: 'Servers' },
];

export function Navigation({ siteName }: { siteName: string }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [mobilePlayersExpanded, setMobilePlayersExpanded] = useState(false);
  const pathname = usePathname();

  // Check if a path is active (exact match)
  const isActive = (href: string) => {
    return pathname === href;
  };

  // Check if we're on any page under this parent route (for dropdown parent highlighting)
  const isParentActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(href + '/');
  };

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
                  link.children ? (
                    // Dropdown menu for items with children
                    <div
                      key={link.href}
                      className="relative"
                      onMouseEnter={() => setOpenDropdown(link.href)}
                      onMouseLeave={() => setOpenDropdown(null)}
                    >
                      <Link
                        href={link.href}
                        className={`inline-flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                          isParentActive(link.href)
                            ? 'text-text bg-surface-hover'
                            : 'text-text-muted hover:bg-surface-hover hover:text-text'
                        }`}
                      >
                        {link.label}
                        <ChevronDown className="h-4 w-4" />
                      </Link>
                      
                      {/* Dropdown panel */}
                      {openDropdown === link.href && (
                        <div className="absolute left-0 mt-0 w-48 rounded-md shadow-lg bg-surface border border-border ring-1 ring-black ring-opacity-5">
                          <div className="py-1" role="menu" aria-orientation="vertical">
                            {link.children.map((child) => (
                              <Link
                                key={child.href}
                                href={child.href}
                                className={`block px-4 py-2 text-sm transition-colors ${
                                  isActive(child.href)
                                    ? 'text-primary bg-surface-hover'
                                    : 'text-text-muted hover:bg-surface-hover hover:text-text'
                                }`}
                                role="menuitem"
                              >
                                {child.label}
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    // Regular link for items without children
                    <Link
                      key={link.href}
                      href={link.href}
                      aria-current={isActive(link.href) ? 'page' : undefined}
                      className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        isActive(link.href)
                          ? 'text-text bg-surface-hover'
                          : 'text-text-muted hover:bg-surface-hover hover:text-text'
                      }`}
                    >
                      {link.label}
                    </Link>
                  )
                ))}
              </div>
            </div>
          </div>

          {/* Desktop search and theme toggle */}
          <div className="hidden md:flex items-center gap-4">
            <SearchDropdown />
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
                link.children ? (
                  // Mobile dropdown for items with children
                  <div key={link.href} className="space-y-1">
                    <button
                      onClick={() => setMobilePlayersExpanded(!mobilePlayersExpanded)}
                      className="w-full flex items-center justify-between text-text-muted px-3 py-2 text-base font-medium hover:bg-surface-hover rounded-md transition-colors"
                    >
                      {link.label}
                      <ChevronDown className={`h-4 w-4 transition-transform ${mobilePlayersExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    {mobilePlayersExpanded && (
                      <div className="flex flex-col space-y-1 pl-4">
                        {link.children.map((child) => (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={() => setMobileMenuOpen(false)}
                            className={`px-3 py-2 rounded-md text-sm transition-colors ${
                              isActive(child.href)
                                ? 'text-primary bg-surface-hover'
                                : 'text-text-muted hover:bg-surface-hover hover:text-text'
                            }`}
                          >
                            {child.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  // Regular link for items without children
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`px-3 py-2 rounded-md text-base font-medium transition-colors ${
                      isActive(link.href)
                        ? 'text-text bg-surface-hover'
                        : 'text-text-muted hover:bg-surface-hover hover:text-text'
                    }`}
                  >
                    {link.label}
                  </Link>
                )
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