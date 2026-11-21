'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useOnline, useSession } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { flush, pending } from '@/lib/outbox';
import {
  clearSession,
  getHelperSession,
  HOME,
  saveHelperSession,
  saveSession,
  type Role,
} from '@/lib/session';
import { IconUsers } from './icons';
import { OfflineBanner, Skeleton } from './ui';

const STAFF_NAV: Partial<Record<Role, { href: string; label: string }[]>> = {
  officer: [
    { href: '/officer', label: 'Queue' },
    { href: '/officer/payments', label: 'Payments' },
  ],
  admin: [
    { href: '/admin', label: 'Rules' },
    { href: '/admin/ai', label: 'AI' },
    { href: '/admin/money', label: 'Money' },
    { href: '/admin/keys', label: 'API keys' },
    { href: '/judge', label: 'Judge Mode' },
    { href: '/phone', label: 'Mock phone' },
  ],
  auditor: [{ href: '/auditor', label: 'Audit log' }],
};

/**
 * Page frame: prototype label, language toggle, offline banner, outbox counter, Helper Mode banner.
 * `roles` guards the page: no session → login; wrong role → that role's home.
 */
export function Shell({
  roles,
  children,
  wide = false,
}: {
  roles: Role[];
  children: ReactNode;
  wide?: boolean;
}) {
  const session = useSession();
  const router = useRouter();
  const path = usePathname();
  const online = useOnline();
  const { t, toggle } = useI18n();
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    if (session === null) router.replace('/login');
    else if (session && !roles.includes(session.role)) router.replace(HOME[session.role]);
  }, [session, roles, router]);

  useEffect(() => {
    const count = () => void pending().then((p) => setWaiting(p.length));
    const tryFlush = () => void flush().then(count);
    count();
    tryFlush();
    window.addEventListener('online', tryFlush);
    window.addEventListener('hq:outbox', count);
    return () => {
      window.removeEventListener('online', tryFlush);
      window.removeEventListener('hq:outbox', count);
    };
  }, []);

  if (!session || !roles.includes(session.role)) return <Skeleton lines={4} />;

  const logout = async () => {
    await api.logout(session.refreshToken).catch(() => undefined);
    clearSession();
    router.replace('/login');
  };

  const leaveFamily = () => {
    const helper = getHelperSession();
    if (helper) saveSession(helper);
    saveHelperSession(null);
    router.replace('/helper');
  };

  const nav = STAFF_NAV[session.role];
  const isStaff = !!nav;

  return (
    <div className="mx-auto flex min-h-dvh flex-col">
      <p className="bg-amber-100 px-3 py-1 text-center text-xs font-semibold text-amber-900">
        {t('prototype')}
      </p>
      <header className="bg-brand text-white">
        <div
          className={`mx-auto flex items-center gap-3 px-4 py-3 ${wide ? 'max-w-6xl' : 'max-w-xl'}`}
        >
          <Link
            href={HOME[session.role]}
            className="inline-flex min-h-12 items-center px-1 text-2xl font-bold"
          >
            {t('appName')}
          </Link>
          <span className="latin truncate text-sm opacity-90">{session.name}</span>
          <span className="flex-1" />
          <button
            onClick={toggle}
            className="min-h-12 rounded-lg px-3 text-sm underline-offset-4 hover:underline"
          >
            {t('switchLang')}
          </button>
          <button
            onClick={logout}
            className="min-h-12 rounded-lg px-3 text-sm underline-offset-4 hover:underline"
          >
            {t('logout')}
          </button>
        </div>
        {nav && (
          <nav
            className="latin mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 pb-2 text-sm"
            dir="ltr"
          >
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`whitespace-nowrap rounded-lg px-3 py-2 ${path === n.href ? 'bg-white text-brand' : 'hover:bg-white/10'}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      {session.role === 'helper' && session.familyLabel && (
        <div className="flex items-center gap-3 bg-brand-soft px-4 py-2 text-brand-dark">
          <IconUsers className="h-6 w-6 shrink-0" />
          <span className="flex-1 font-semibold">
            {t('actingFor')} {session.familyLabel}
          </span>
          <button
            onClick={leaveFamily}
            className="min-h-12 rounded-lg border-2 border-brand px-3 text-sm font-semibold"
          >
            {t('switchFamily')}
          </button>
        </div>
      )}
      <OfflineBanner online={online} waiting={waiting} />

      <main
        dir={isStaff ? 'ltr' : undefined}
        className={`mx-auto w-full flex-1 px-4 py-5 ${wide ? 'max-w-6xl' : 'max-w-xl'} ${isStaff ? 'latin' : ''}`}
      >
        {children}
      </main>
    </div>
  );
}
