import { Suspense } from 'react';
import { Skeleton } from '@/components/ui';
import { OfficerPayments } from '@/features/officer/payments';

export default function Page() {
  return (
    <Suspense fallback={<Skeleton lines={5} />}>
      <OfficerPayments />
    </Suspense>
  );
}
