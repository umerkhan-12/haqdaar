'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Skeleton } from '@/components/ui';
import { useSession } from '@/lib/hooks';
import { HOME } from '@/lib/session';

export default function Home() {
  const session = useSession();
  const router = useRouter();
  useEffect(() => {
    if (session === null) router.replace('/login');
    else if (session) router.replace(session.role === 'helper' && session.personId ? '/citizen' : HOME[session.role]);
  }, [session, router]);
  return <Skeleton lines={3} />;
}
