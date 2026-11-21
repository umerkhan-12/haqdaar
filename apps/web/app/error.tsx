'use client';

import { Button, StatusCard } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

/** Error boundary: a calm message and a way forward — never a stack trace. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 py-10">
      <StatusCard tone="bad" title={t('error')} urgent />
      <Button onClick={reset}>{t('retry')}</Button>
    </main>
  );
}
