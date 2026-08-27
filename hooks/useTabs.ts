'use client';

import { useId, type KeyboardEvent } from 'react';

const MOVE_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];

/**
 * ARIA plumbing for a tab bar, with manual activation: arrows and Home/End move
 * focus, and the button's own click/Enter/Space still does the selecting, so
 * arrowing past a tab never triggers its fetch.
 *
 * @param activeTab - The currently selected tab id
 * @returns Prop spreads for the tablist container, each tab, and the panel
 */
export function useTabs<T extends string>(activeTab: T) {
  const prefix = useId();
  const tabId = (id: T) => `${prefix}-tab-${id}`;
  const panelId = (id: T) => `${prefix}-panel-${id}`;

  const tablistProps = {
    role: 'tablist' as const,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (!MOVE_KEYS.includes(e.key)) return;
      const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
      const current = tabs.indexOf(document.activeElement as HTMLElement);
      if (current < 0) return;

      e.preventDefault();
      const next =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? tabs.length - 1
            : (current + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus();
    },
  };

  // Only the selected tab is a tab stop; the arrows reach the rest.
  const tabProps = (id: T) => ({
    id: tabId(id),
    role: 'tab' as const,
    'aria-selected': activeTab === id,
    'aria-controls': panelId(id),
    tabIndex: activeTab === id ? 0 : -1,
  });

  const panelProps = (id: T) => ({
    id: panelId(id),
    role: 'tabpanel' as const,
    'aria-labelledby': tabId(id),
  });

  return { tablistProps, tabProps, panelProps };
}
