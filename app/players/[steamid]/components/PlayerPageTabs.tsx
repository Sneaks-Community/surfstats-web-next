'use client';

import { useState, type ReactNode } from 'react';
import { LayoutDashboard, Clock } from 'lucide-react';

interface PlayerPageTabsProps {
  overview: ReactNode;
  times: ReactNode;
}

type TopTab = 'overview' | 'times';

/**
 * Top-level Overview | Times tabs for the player page.
 *
 * Crawler-safety hard rule: the active tab hard-defaults to Overview and is
 * deliberately NOT initialized from the URL / searchParams. A sitemap or
 * internal link carrying a tab param must never auto-open (and, once Times
 * fetches on activation, auto-fetch) the expensive Times section under a
 * crawler's renderer.
 *
 * Times is conditionally *mounted* (not CSS-hidden) — it only enters the tree
 * once the user selects it, so its mount effects never run for a crawler that
 * renders only the default Overview.
 */
export default function PlayerPageTabs({ overview, times }: PlayerPageTabsProps) {
  const [activeTab, setActiveTab] = useState<TopTab>('overview');
  // Times mounts on its first activation and then stays mounted (CSS-toggled),
  // so switching back and forth doesn't refetch. It is never mounted until the
  // user clicks Times.
  const [timesActivated, setTimesActivated] = useState(false);

  const selectTab = (tab: TopTab) => {
    if (tab === 'times') setTimesActivated(true);
    setActiveTab(tab);
  };

  const tabs = [
    { id: 'overview' as TopTab, label: 'Overview', icon: LayoutDashboard },
    { id: 'times' as TopTab, label: 'Times', icon: Clock },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="flex">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => selectTab(tab.id)}
                className={`flex-1 px-4 py-3 flex items-center justify-center gap-2 transition-colors relative ${
                  isActive
                    ? 'bg-surface-hover text-text'
                    : 'text-text-muted hover:text-text hover:bg-surface-hover/50'
                }`}
              >
                <Icon className={`h-4 w-4 sm:h-5 sm:w-5 ${isActive ? 'text-primary-500' : ''}`} />
                <span className="font-medium text-sm sm:text-base">{tab.label}</span>
                {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-500" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className={activeTab === 'overview' ? undefined : 'hidden'}>{overview}</div>
      {timesActivated && (
        <div className={activeTab === 'times' ? undefined : 'hidden'}>{times}</div>
      )}
    </div>
  );
}
