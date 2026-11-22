'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CitizenShell } from '@/components/citizen-shell';
import { IconUsers } from '@/components/icons';
import {
  AudioButton,
  Button,
  ErrorState,
  Skeleton,
  StatusCard,
  VerdictCard,
} from '@/components/ui';
import { api, type ScamVerdict } from '@/lib/api';
import { useSession } from '@/lib/hooks';
import { useI18n, type MessageKey } from '@/lib/i18n';

/** The district of her saved or last claim, if this phone knows one: it places the message on the Scam Map. */
function knownDistrict(personId: string | null | undefined): string | null {
  if (!personId) return null;
  try {
    const draft = JSON.parse(localStorage.getItem(`hq.claim.${personId}`) ?? 'null') as {
      details?: { district?: string };
    } | null;
    return draft?.details?.district || localStorage.getItem('hq.district') || null;
  } catch {
    return null;
  }
}

export function ScamCheck() {
  const { t, speak, lang } = useI18n();
  const session = useSession();
  const [text, setText] = useState('');
  const [verdict, setVerdict] = useState<ScamVerdict | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<'no' | 'sending' | 'yes'>('no');

  // She hears what this screen is for as soon as it opens.
  useEffect(() => {
    if (session) speak([t('scam'), t('scamPaste')]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!session]);

  async function check() {
    setBusy(true);
    setError(null);
    setVerdict(null);
    setSent('no');
    try {
      const v = await api.scamCheck(text.trim(), knownDistrict(session?.personId));
      setVerdict(v);
      // The answer is spoken at once: she should not have to find and read it.
      speak([
        t(`verdict${v.verdict}` as MessageKey),
        lang === 'ur' ? v.explanationUr : v.explanationEn,
      ]);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  /** "Not sure" must end with a person: the message goes to an officer, with the system's notes attached. */
  async function showOfficer() {
    if (!verdict) return;
    setSent('sending');
    try {
      await api.reportScam({
        text: text.trim(),
        verdict: verdict.verdict,
        redFlags: verdict.redFlags,
        district: knownDistrict(session?.personId),
      });
      setSent('yes');
      speak(t('scamSentOfficer'));
    } catch (e) {
      setSent('no');
      setError(e);
    }
  }

  return (
    <CitizenShell>
      <Link
        href="/citizen"
        className="mb-4 inline-flex min-h-12 min-w-12 items-center px-2 text-brand underline"
      >
        {t('back')}
      </Link>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">{t('scam')}</h1>
        <AudioButton text={[t('scam'), t('scamPaste')]} className="text-brand" />
      </div>
      <label className="block space-y-2">
        <span className="text-lg">{t('scamPaste')}</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          maxLength={2000}
          dir="auto"
          className="w-full rounded-xl border-2 border-slate-400 bg-white p-3 text-lg"
        />
      </label>
      <Button
        className="mt-3 min-h-16 w-full text-xl"
        disabled={busy || text.trim().length < 3}
        onClick={check}
      >
        {t('check')}
      </Button>
      <div className="mt-5 space-y-4" aria-live="polite">
        {busy && <Skeleton lines={2} />}
        {error ? <ErrorState error={error} onRetry={check} /> : null}
        {verdict && <VerdictCard v={verdict} />}
        {verdict && verdict.verdict !== 'GENUINE' && sent !== 'yes' && (
          <button
            type="button"
            onClick={showOfficer}
            disabled={sent === 'sending'}
            className="flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl border-2 border-brand bg-white px-5 text-xl font-semibold text-brand-dark disabled:opacity-50"
          >
            <IconUsers className="h-8 w-8" />
            {t('scamShowOfficer')}
          </button>
        )}
        {sent === 'yes' && <StatusCard tone="info" title={t('scamSentOfficer')} />}
      </div>
    </CitizenShell>
  );
}
