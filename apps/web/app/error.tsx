'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Button, StatusCard } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

/** Error boundary: a calm message, spoken, and a way forward — never a stack trace. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const { t, speak } = useI18n();
  const text = t('error');
  useEffect(() => speak(text), [speak, text]);

  return (
    <>
      <p className="bg-amber-100 px-3 py-1 text-center text-xs font-semibold text-amber-900">
        {t('prototype')}
      </p>
      <main className="mx-auto max-w-xl space-y-4 px-4 py-10">
        {/* StatusCard carries the Listen button for this message. */}
        <StatusCard tone="bad" title={text} urgent />
        <Button className="w-full" onClick={reset}>
          {t('retry')}
        </Button>
        <Link
          replace
          href="/"
          className="flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-brand bg-white px-5 text-lg font-semibold text-brand-dark"
        >
          {t('goHome')}
        </Link>
      </main>
    </>
  );
}
