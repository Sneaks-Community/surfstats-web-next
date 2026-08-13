import { PageHeaderSkeleton, SkeletonScreen } from '@/components/Skeleton';
import CountriesTableSkeleton from '@/components/CountriesTableSkeleton';

export default function Loading() {
  return (
    <SkeletonScreen label="Loading countries..." className="space-y-6">
      <PageHeaderSkeleton eyebrow titleWidth="w-48" subtitleWidth="w-96" />

      <CountriesTableSkeleton />
    </SkeletonScreen>
  );
}
