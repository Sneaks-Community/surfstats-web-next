'use client';

import dynamic from 'next/dynamic';
import ChartSkeleton from '@/components/ChartSkeleton';

// Lazy-load the chart.js + geo bundle so it's only fetched on the client after
// hydration, keeping the countries route's initial JS small. A Server Component
// (the countries page) can't call `dynamic({ ssr: false })` itself, so this
// client barrel holds the definition and is imported by it.
export const WorldReachChart = dynamic(() => import('./WorldReachChart'), {
  ssr: false,
  loading: () => <ChartSkeleton minBodyHeight={340} />,
});
