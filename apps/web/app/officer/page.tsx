import { Suspense } from 'react';
import { Skeleton } from '@/components/ui';
import { OfficerQueue } from '@/features/officer/queue';

export default function Page() {
  return (
    <Suspense fallback={<Skeleton lines={6} />}>
      <OfficerQueue />
    </Suspense>
  );
}
