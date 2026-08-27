'use client';

import { useState, type ReactNode } from 'react';
import { useTabs } from '@/hooks/useTabs';
import { LayoutDashboard, Clock } from 'lucide-react';

interface MapPageTabsProps {
  overview: ReactNode;
  times: ReactNode;
}

type TopTab = 'overview' | 'times';

/**
 * Overview | Times tabs. The active tab is client-only and never read from the
 * URL, and Times is conditionally mounted (not CSS-hidden), so a crawler never
 * mounts Times or triggers its record fetches.
 */
export default function MapPageTabs({ overview, times }: MapPageTabsProps) {
  const [activeTab, setActiveTab] = useState<TopTab>('overview');
  const { tablistProps, tabProps, panelProps } = useTabs(activeTab);
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
        <div className="flex" {...tablistProps}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                {...tabProps(tab.id)}
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

      <div {...panelProps('overview')} className={activeTab === 'overview' ? undefined : 'hidden'}>
        {overview}
      </div>
      {timesActivated && (
        <div {...panelProps('times')} className={activeTab === 'times' ? undefined : 'hidden'}>
          {times}
        </div>
      )}
    </div>
  );
}
