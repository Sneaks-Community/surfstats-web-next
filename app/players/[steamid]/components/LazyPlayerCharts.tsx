'use client';

import dynamic from 'next/dynamic';
import ChartSkeleton from '@/components/ChartSkeleton';

// Lazy-load the chart.js-backed charts so their (heavy) bundle is only fetched
// on the client after hydration, keeping the player route's initial JS small.
// A Server Component (PlayerProfileContent) can't call `dynamic({ ssr: false })`
// itself, so these client-side definitions live here and are imported by it.
const loading = () => <ChartSkeleton minBodyHeight={200} />;

export const TierDistributionChart = dynamic(() => import('./TierDistributionChart'), {
  ssr: false,
  loading,
});
export const CompletionPercentileChart = dynamic(() => import('./CompletionPercentileChart'), {
  ssr: false,
  loading,
});
export const CompletionBreakdownChart = dynamic(() => import('./CompletionBreakdownChart'), {
  ssr: false,
  loading,
});
export const CareerTimelineChart = dynamic(() => import('./CareerTimelineChart'), {
  ssr: false,
  loading,
});
export const MapEngagementChart = dynamic(() => import('./MapEngagementChart'), {
  ssr: false,
  loading,
});
