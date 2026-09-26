import { Skeleton } from '@/components/ui/skeleton';

export const PriceSkeleton = () => (
  <div className="space-y-1">
    <Skeleton className="h-8 w-24" />
    <Skeleton className="h-4 w-16" />
  </div>
);

export const PriceInlineSkeleton = () => (
  <Skeleton className="h-4 w-28 inline-block" />
);
