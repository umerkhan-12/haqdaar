'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { CitizenShell } from '@/components/citizen-shell';
import { IconCheck, IconLock, IconMic } from '@/components/icons';
import {
  AudioButton,
  Button,
  ErrorState,
  Field,
  inputCls,
  laneTone,
  LinkButton,
  Skeleton,
  StatusCard,
} from '@/components/ui';
import { api, ApiError, type CaseDetail, type ClaimInput } from '@/lib/api';
import { useSession } from '@/lib/hooks';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { enqueue } from '@/lib/outbox';
import { CnicPhoto } from './cnic-photo';

type Step = 'speak' | 'confirm' | 'photo' | 'consent' | 'done';

interface Details {
  fullName: string;
  cnic: string;
  district: string;
  householdSize: string;
  alias: string;
}

const DISTRICTS = [
  'Thatta',
  'Sujawal',
  'Badin',
  'Tharparkar',
  'Karachi West',
  'Karachi East',
  'Hyderabad',
  'Sukkur',
  'Larkana',
];
const CONSENTS = [
  { purpose: 'identity_verification', label: 'consentIdentity' },
  { purpose: 'household_data', label: 'consentHousehold' },
] as const;

/** 4210112345673 → 42101-1234567-3 while typing. */
function formatCnic(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 13);
  return [d.slice(0, 5), d.slice(5, 12), d.slice(12)].filter(Boolean).join('-');
}

export function ClaimFlow() {
  const { t, speak, lang } = useI18n();
  const session = useSession();
  const [step, setStep] = useState<Step>('speak');
  const [details, setDetails] = useState<Details>({
    fullName: '',
    cnic: '',
    district: '',
    householdSize: '',
    alias: '',
  });
  const [aiUnsure, setAiUnsure] = useState(false);
  // Consent must be an explicit act: nothing is pre-ticked.
  const [consents, setConsents] = useState<string[]>([]);
  const [result, setResult] = useState<
    { kind: 'sent'; case: CaseDetail } | { kind: 'saved' } | null
  >(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<'' | 'recording' | 'understanding' | 'sending'>('');
  const key = useRef(crypto.randomUUID());
  const recorder = useRef<MediaRecorder | null>(null);

  const set = (k: keyof Details) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDetails((d) => ({ ...d, [k]: k === 'cnic' ? formatCnic(e.target.value) : e.target.value }));

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        void understand(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      };
      rec.start();
      recorder.current = rec;
      setBusy('recording');
    } catch {
      goManual();
    }
  }

  function stopRecording() {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }

  async function understand(audio: Blob) {
    setBusy('understanding');
    try {
      const heard = await api.transcribe(audio);
      if (!heard.understood) return goManual();
      const ex = await api.extract(heard.text);
      const x = ex.extraction;
      setDetails((d) => ({
        fullName: x?.fullName ?? d.fullName,
        cnic: x?.cnic ?? d.cnic,
        district: x?.district ?? d.district,
        householdSize: x?.householdSize ? String(x.householdSize) : d.householdSize,
        alias: x?.phone ?? d.alias,
      }));
      setAiUnsure(ex.needsHuman);
      setStep('confirm');
    } catch {
      goManual();
    } finally {
      setBusy('');
    }
  }

  /** AI off, unsure or no microphone: the citizen (or helper) simply types. Never a dead end. */
  function goManual() {
    setBusy('');
    setAiUnsure(true);
    setStep('confirm');
    speak(t('aiUnsure'));
  }

  async function send() {
    if (!session?.personId) return;
    const claim: ClaimInput = {
      type: 'relief_claim',
      fullName: details.fullName.trim(),
      cnic: details.cnic,
      district: details.district || undefined,
      householdSize: details.householdSize ? Number(details.householdSize) : undefined,
      payout: { alias: details.alias.replace(/\D/g, '') },
    };
    setBusy('sending');
    setError(null);
    try {
      if (!navigator.onLine) throw new ApiError(0, 'offline');
      for (const purpose of consents) await api.grantConsent(session.personId, purpose);
      const c = await api.submitClaim(claim, key.current);
      setResult({ kind: 'sent', case: c });
      setStep('done');
      speak(t(`lane${c.lane ?? 'HUMAN_REVIEW'}` as MessageKey));
    } catch (e) {
      if (e instanceof ApiError && e.offline) {
        await enqueue({ key: key.current, claim, personId: session.personId, consents });
        setResult({ kind: 'saved' });
        setStep('done');
        speak(t('savedOffline'));
      } else setError(e);
    } finally {
      setBusy('');
    }
  }

  const detailsValid =
    details.fullName.trim().length >= 2 &&
    /^\d{5}-\d{7}-\d$/.test(details.cnic) &&
    /^03\d{9}$/.test(details.alias.replace(/\D/g, ''));

  return (
    <CitizenShell>
      <Link
        href="/citizen"
        className="mb-4 inline-flex min-h-12 min-w-12 items-center px-2 text-brand underline"
      >
        {t('back')}
      </Link>

      {step === 'speak' && (
        <div className="space-y-6 text-center">
          <div className="flex items-center justify-center gap-3">
            <h1 className="text-2xl font-bold">{t('recordHold')}</h1>
            <AudioButton text={`${t('recordHold')}. ${t('recordHint')}`} className="text-brand" />
          </div>
          <p className="text-lg text-muted">{t('recordHint')}</p>
          {busy === 'understanding' ? (
            <Skeleton lines={2} />
          ) : (
            <button
              type="button"
              onPointerDown={startRecording}
              onPointerUp={stopRecording}
              onPointerLeave={stopRecording}
              onContextMenu={(e) => e.preventDefault()}
              aria-label={t('recordHold')}
              className={`mx-auto grid h-44 w-44 select-none place-items-center rounded-full text-white shadow-lg touch-none ${
                busy === 'recording' ? 'animate-pulse bg-red-600' : 'bg-brand'
              }`}
            >
              <IconMic className="h-20 w-20" />
            </button>
          )}
          {busy === 'recording' && (
            <p className="text-xl font-semibold text-red-700">{t('recording')}</p>
          )}
          <Button variant="ghost" onClick={goManual} className="w-full">
            {t('typeInstead')}
          </Button>
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-4">
          <h1 className="text-2xl font-bold">{t('checkDetails')}</h1>
          {aiUnsure && <StatusCard tone="warn" title={t('aiUnsure')} />}
          <Field label={t('fullName')}>
            <input
              className={inputCls}
              value={details.fullName}
              onChange={set('fullName')}
              autoComplete="name"
            />
          </Field>
          <Field label={t('cnic')}>
            <input
              className={inputCls}
              dir="ltr"
              inputMode="numeric"
              placeholder="42101-1234567-1"
              value={details.cnic}
              onChange={set('cnic')}
            />
          </Field>
          <Field label={t('district')}>
            <select className={inputCls} value={details.district} onChange={set('district')}>
              <option value="">—</option>
              {DISTRICTS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </Field>
          <Field label={t('household')}>
            <input
              className={inputCls}
              dir="ltr"
              inputMode="numeric"
              value={details.householdSize}
              onChange={set('householdSize')}
            />
          </Field>
          <Field label={t('payoutPhone')}>
            <input
              className={inputCls}
              dir="ltr"
              inputMode="tel"
              placeholder="03XXXXXXXXX"
              value={details.alias}
              onChange={set('alias')}
            />
          </Field>
          <Button className="w-full" disabled={!detailsValid} onClick={() => setStep('photo')}>
            {t('next')}
          </Button>
        </div>
      )}

      {step === 'photo' && <CnicPhoto cnic={details.cnic} onDone={() => setStep('consent')} />}

      {step === 'consent' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <IconLock className="h-8 w-8 text-brand" />
            <h1 className="flex-1 text-2xl font-bold">{t('consentTitle')}</h1>
            <AudioButton
              text={[...CONSENTS.map((c) => t(c.label)), t('consentNote')].join('. ')}
              className="text-brand"
            />
          </div>
          {CONSENTS.map((c) => {
            const on = consents.includes(c.purpose);
            return (
              <button
                key={c.purpose}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() =>
                  setConsents((cs) => (on ? cs.filter((x) => x !== c.purpose) : [...cs, c.purpose]))
                }
                className={`flex min-h-20 w-full items-center gap-4 rounded-2xl border-2 p-4 text-start text-lg ${
                  on ? 'border-brand bg-brand-soft' : 'border-slate-300 bg-white'
                }`}
              >
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg border-2 ${on ? 'border-brand bg-brand text-white' : 'border-slate-400'}`}
                >
                  {on && <IconCheck className="h-6 w-6" />}
                </span>
                {t(c.label)}
              </button>
            );
          })}
          <p className="text-muted">{t('consentNote')}</p>
          {error ? <ErrorState error={error} /> : null}
          <Button className="w-full" disabled={busy === 'sending'} onClick={send}>
            {busy === 'sending' ? t('sending') : t('send')}
          </Button>
        </div>
      )}

      {step === 'done' && result && (
        <div className="space-y-4">
          {result.kind === 'saved' ? (
            <StatusCard tone="warn" title={t('savedOffline')} />
          ) : (
            <>
              <StatusCard
                tone={laneTone(result.case.lane)}
                title={t(`lane${result.case.lane ?? 'HUMAN_REVIEW'}` as MessageKey)}
                body={
                  lang === 'ur'
                    ? result.case.decision?.explanationUr
                    : result.case.decision?.explanationEn
                }
              />
              {result.case.lane !== 'AUTO_APPROVE' && (
                <StatusCard tone="info" title={t('waitingOfficer')} />
              )}
            </>
          )}
          <LinkButton href="/citizen/status">{t('status')}</LinkButton>
        </div>
      )}
    </CitizenShell>
  );
}
