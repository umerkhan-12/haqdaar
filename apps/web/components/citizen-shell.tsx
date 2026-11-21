'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useSession } from '@/lib/hooks';
import { Shell } from './shell';

/** Citizen screens: the citizen herself, or a helper who has switched to a family with its PIN. */
export function CitizenShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  useEffect(() => {
    if (session?.role === 'helper' && !session.personId) router.replace('/helper');
  }, [session, router]);
  return <Shell roles={['citizen', 'helper']}>{children}</Shell>;
}
