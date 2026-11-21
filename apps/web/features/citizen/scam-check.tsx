'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CitizenShell } from '@/components/citizen-shell';
import { AudioButton, Button, ErrorState, Skeleton, VerdictCard } from '@/components/ui';
import { api, type ScamVerdict } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export function ScamCheck() {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [verdict, setVerdict] = useState<ScamVerdict | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    setError(null);
    setVerdict(null);
    try {
      setVerdict(await api.scamCheck(text.trim()));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <CitizenShell>
      <Link href="/citizen" className="mb-4 inline-flex min-h-12 min-w-12 items-center px-2 text-brand underline">
        {t('back')}
      </Link>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">{t('scam')}</h1>
        <AudioButton text={`${t('scam')}. ${t('scamPaste')}`} className="text-brand" />
      </div>
      <label className="block space-y-2">
        <span className="text-lg">{t('scamPaste')}</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          maxLength={2000}
          className="w-full rounded-xl border-2 border-slate-400 bg-white p-3 text-lg"
        />
      </label>
      <Button className="mt-3 w-full" disabled={busy || text.trim().length < 3} onClick={check}>
        {t('check')}
      </Button>
      <div className="mt-5" aria-live="polite">
        {busy && <Skeleton lines={2} />}
        {error ? <ErrorState error={error} onRetry={check} /> : null}
        {verdict && <VerdictCard v={verdict} />}
      </div>
    </CitizenShell>
  );
}
