'use client';

import dynamic from 'next/dynamic';
import ChartSkeleton from '@/components/ChartSkeleton';

// Fetches the chart.js + geo bundle after hydration, keeping it out of the countries page's
// initial JS. Server Components can't call `dynamic({ ssr: false })`, so the page imports this.
export const WorldReachChart = dynamic(() => import('./WorldReachChart'), {
  ssr: false,
  loading: () => <ChartSkeleton minBodyHeight={340} />,
});
