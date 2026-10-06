'use client';

import dynamic from 'next/dynamic';
import ChartSkeleton from '@/components/ChartSkeleton';

// chart.js loads client-side after hydration, keeping initial JS small. Defined here because a
// Server Component (PlayerProfileContent) can't call `dynamic({ ssr: false })`.
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
