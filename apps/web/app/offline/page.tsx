'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { IconWifiOff } from '@/components/icons';
import { AudioButton } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

/** Served by the service worker when a page is not cached and there is no network. */
export default function OfflinePage() {
  const { t, speak } = useI18n();
  const text = `${t('offlineTitle')}. ${t('offlineBody')}`;
  useEffect(() => speak(text), [speak, text]);

  return (
    <>
      <p className="bg-amber-100 px-3 py-1 text-center text-xs font-semibold text-amber-900">
        {t('prototype')}
      </p>
      <main className="mx-auto max-w-xl space-y-4 px-4 py-10 text-center">
        <IconWifiOff className="mx-auto h-16 w-16 text-amber-700" aria-hidden />
        <h1 className="text-2xl font-bold">{t('offlineTitle')}</h1>
        <p className="text-lg">{t('offlineBody')}</p>
        <div className="flex justify-center">
          <AudioButton text={text} className="text-brand" />
        </div>
        <Link
          href="/citizen"
          className="flex min-h-12 w-full items-center justify-center rounded-xl bg-brand px-5 text-lg font-semibold text-white"
        >
          {t('goHome')}
        </Link>
      </main>
    </>
  );
}
