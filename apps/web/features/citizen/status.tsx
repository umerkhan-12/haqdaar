'use client';

import Link from 'next/link';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { CitizenShell } from '@/components/citizen-shell';
import {
  AudioButton,
  Button,
  EmptyState,
  ErrorState,
  LinkButton,
  Skeleton,
  StatusCard,
  Timeline,
} from '@/components/ui';
import { api, type CaseDetail, type CaseStatus } from '@/lib/api';
import { useAsync, useSession } from '@/lib/hooks';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { urduNumberWords } from '@/lib/urdu-number';
import { missingPurposes, purposeText } from './consent-purposes';
import { CorrectDetails, correctionReady, sendableCorrection } from './correct-details';
import { RefusedClaims } from './refused-claims';
import { SimpleWordsLabel, useSimpleExplanation } from './simple-explanation';

const STATUS_TONE: Partial<Record<CaseStatus, 'ok' | 'bad' | 'warn' | 'info'>> = {
  PAID: 'ok',
  APPROVED: 'ok',
  REJECTED: 'bad',
  NEEDS_INFO: 'warn',
  IN_REVIEW: 'info',
};

/** Typed as full records so a new status cannot be added without its Urdu and English words. */
const STATUS_KEY: Record<CaseStatus, MessageKey> = {
  DRAFT: 'statusDRAFT',
  SUBMITTED: 'statusSUBMITTED',
  PROCESSING: 'statusPROCESSING',
  NEEDS_INFO: 'statusNEEDS_INFO',
  IN_REVIEW: 'statusIN_REVIEW',
  APPROVED: 'statusAPPROVED',
  REJECTED: 'statusREJECTED',
  PAID: 'statusPAID',
  CLOSED: 'statusCLOSED',
};
const CHIP_KEY: Record<CaseStatus, MessageKey> = {
  DRAFT: 'chipDRAFT',
  SUBMITTED: 'chipSUBMITTED',
  PROCESSING: 'chipPROCESSING',
  NEEDS_INFO: 'chipNEEDS_INFO',
  IN_REVIEW: 'chipIN_REVIEW',
  APPROVED: 'chipAPPROVED',
  REJECTED: 'chipREJECTED',
  PAID: 'chipPAID',
  CLOSED: 'chipCLOSED',
};

/** Every timeline type the cases service writes (`payment.<state>` comes from the payments events). */
const EVENT_KEY: Record<string, MessageKey> = {
  submitted: 'ev_submitted',
  approved: 'ev_approved',
  rejected: 'ev_rejected',
  info_requested: 'ev_info_requested',
  info_provided: 'ev_info_provided',
  assigned: 'ev_assigned',
  consent_withdrawn: 'ev_consent_withdrawn',
  escalated: 'ev_escalated',
  closed: 'ev_closed',
  'payment.created': 'ev_payStarted',
  'payment.awaiting_approval': 'ev_payStarted',
  'payment.approved': 'ev_payStarted',
  'payment.sent': 'ev_paySent',
  'payment.success': 'ev_paySuccess',
  'payment.held': 'ev_payHeld',
  'payment.failed': 'ev_payFailed',
  'payment.unknown': 'ev_payUnknown',
  'payment.reversal_requested': 'ev_payReversal',
  'payment.reversed': 'ev_payReversed',
};
const DECISION_KEY: Record<string, MessageKey> = {
  AUTO_APPROVE: 'ev_decisionAuto',
  HUMAN_REVIEW: 'ev_decisionHuman',
  ASK_MORE: 'ev_decisionAsk',
};

type TimelineEvent = CaseDetail['timeline'][number];

const dataField = (e: TimelineEvent, field: string): string | null => {
  const v = (e.data as Record<string, unknown> | null)?.[field];
  return typeof v === 'string' && v.trim() ? v : null;
};

/** Never a raw enum: an event type the app does not know yet reads as "claim updated". */
function eventKey(e: TimelineEvent): MessageKey {
  if (e.type === 'decision') return DECISION_KEY[dataField(e, 'lane') ?? ''] ?? 'ev_other';
  return EVENT_KEY[e.type] ?? 'ev_other';
}

/** Timeline rows in her language; repeats of the same step in a row collapse into the latest one. */
function timelineRows(events: TimelineEvent[], t: (k: MessageKey) => string) {
  const rows: { label: string; at: string }[] = [];
  for (const e of events) {
    const label = t(eventKey(e));
    if (rows.at(-1)?.label === label) rows[rows.length - 1] = { label, at: e.at };
    else rows.push({ label, at: e.at });
  }
  return rows;
}

/** "12,000 rupees" for the eye; Urdu number words for the ear, the way people say money. */
function useAmountText(amount: number) {
  const { t, lang } = useI18n();
  const digits = amount.toLocaleString('en-PK');
  const words = lang === 'ur' ? urduNumberWords(amount) : null;
  return { digits, words, spoken: `${words ?? digits} ${t('rupees')}` };
}

/** Haq Receipt: the exact amount, big, spoken, so nobody can quietly keep part of it. */
function HaqReceipt({ amount, caseId }: { amount: number; caseId: string }) {
  const { t } = useI18n();
  const { digits, words, spoken } = useAmountText(amount);
  // The seal and its QR: proof that this receipt is genuine. Missing offline; the amount still shows.
  const [seal, setSeal] = useState<{ code: string; ref: string | null; qr: string } | null>(null);
  useEffect(() => {
    let live = true;
    api
      .myReceipt(caseId)
      .then(async (r) => {
        const qr = await QRCode.toDataURL(r.sealed, { margin: 1, width: 220 });
        if (live) setSeal({ code: r.code, ref: r.ref, qr });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [caseId]);
  return (
    <div className="rounded-2xl border-4 border-green-700 bg-green-50 p-5 text-center text-green-900">
      <p className="text-lg font-semibold">{t('receiptTitle')}</p>
      <p className="my-2 text-5xl font-bold">
        <span className="latin" dir="ltr">
          {digits}
        </span>{' '}
        <span className="text-3xl">{t('rupees')}</span>
      </p>
      {words && (
        <p className="mb-2 text-2xl font-semibold">
          {words} {t('rupees')}
        </p>
      )}
      <p>{t('receiptLine')}</p>
      {seal && (
        <div className="mt-4 rounded-xl border-2 border-green-700 bg-white p-3">
          <p className="text-lg font-bold">{t('receiptSeal')}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={seal.qr}
            alt={t('receiptSeal')}
            width={176}
            height={176}
            className="mx-auto my-2"
          />
          <p className="latin break-all font-mono text-base font-semibold" dir="ltr">
            {seal.code}
          </p>
          {seal.ref && (
            <p className="text-sm text-slate-600">
              {t('receiptRef')}{' '}
              <span className="latin" dir="ltr">
                {seal.ref}
              </span>
            </p>
          )}
          <p className="mt-2 text-base">{t('receiptSealHint')}</p>
        </div>
      )}
      <div className="mt-3 flex justify-center">
        <AudioButton
          text={`${t('receiptTitle')}. ${spoken}. ${t('receiptLine')}`}
          className="text-green-800"
        />
      </div>
    </div>
  );
}

/**
 * NEEDS_INFO: show what the officer asked, and if a permission is missing say exactly what she is
 * allowing before one tap gives it and resends. Resending without the permission can never succeed.
 */
function NeedsInfo({
  c,
  lead,
  onResent,
}: {
  c: CaseDetail;
  /** The status sentences said first, so her whole task is heard in one go. */
  lead: string[];
  onResent: () => void;
}) {
  const { t, speak, lang } = useI18n();
  const session = useSession();
  const consents = useAsync(() => api.consents(), [c.id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fix, setFix] = useState({ fullName: '', cnic: '' });
  const fixTouched = fix.fullName.trim() !== '' || fix.cnic !== '';

  const asked = c.timeline.filter((e) => e.type === 'info_requested').at(-1);
  const message = asked ? dataField(asked, 'message') : null;
  const missing = consents.data ? missingPurposes(consents.data) : [];
  const allowing = missing.map((p) => `${t(purposeText(p).who)}: ${t(purposeText(p).why)}`);

  // Once the permissions are known: what the officer asked and what she is asked to allow, aloud.
  const ready = !!consents.data;
  useEffect(() => {
    if (!ready) return;
    speak([
      ...lead,
      ...(message ? [t('officerAsks'), message] : []),
      ...(missing.length ? [t('needPermission'), ...allowing, t('consentNote')] : []),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, c.id, lang]);

  async function resend() {
    const personId = session?.personId;
    if (!personId) return;
    setBusy(true);
    setError(null);
    try {
      for (const purpose of missing) await api.grantConsent(personId, purpose);
      await api.resubmit(c.id, sendableCorrection(fix));
      speak(t('resent'));
      onResent();
    } catch (e) {
      setError(e);
      consents.reload();
    } finally {
      setBusy(false);
    }
  }

  if (consents.loading && !consents.data) return <Skeleton lines={1} />;
  if (consents.error) return <ErrorState error={consents.error} onRetry={consents.reload} />;
  return (
    <div className="space-y-4">
      {message && <StatusCard tone="warn" title={t('officerAsks')} body={message} />}
      {missing.length > 0 && (
        <div className="space-y-2 rounded-2xl border-2 border-amber-700 bg-amber-50 p-4 text-amber-900">
          <div className="flex items-start gap-3">
            <p className="flex-1 text-lg font-semibold">{t('needPermission')}</p>
            <AudioButton
              text={`${t('needPermission')} ${allowing.join('. ')}. ${t('consentNote')}`}
            />
          </div>
          <ul className="list-disc space-y-1 ps-6 text-lg">
            {allowing.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>{t('consentNote')}</p>
        </div>
      )}
      <CorrectDetails value={fix} onChange={setFix} />
      {error ? <ErrorState error={error} /> : null}
      <Button
        className="w-full"
        disabled={busy || (fixTouched && !correctionReady(fix))}
        onClick={resend}
      >
        {t(fixTouched ? 'redoSend' : missing.length > 0 ? 'resubmit' : 'resendOnly')}
      </Button>
    </div>
  );
}

/** Claims still moving: the screen asks again by itself so she sees "approved" without reloading. */
const MOVING: CaseStatus[] = ['SUBMITTED', 'PROCESSING', 'IN_REVIEW', 'APPROVED'];

/** A tick that advances every 15 s while the screen is visible and online, and when she comes back to it. */
function useRefreshTick(active: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const bump = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) setTick((n) => n + 1);
    };
    const timer = window.setInterval(bump, 15_000);
    document.addEventListener('visibilitychange', bump);
    window.addEventListener('online', bump);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', bump);
      window.removeEventListener('online', bump);
    };
  }, [active]);
  return tick;
}

function CaseCard({ id, onChange }: { id: string; onChange: () => void }) {
  const { t, lang, speak } = useI18n();
  const [status, setStatus] = useState<CaseStatus | null>(null);
  const tick = useRefreshTick(status === null || MOVING.includes(status));
  const { data: c, error, loading, reload } = useAsync<CaseDetail>(() => api.case(id), [id, tick]);
  // When the status moves (e.g. an officer approves), the claims list chips update too.
  useEffect(() => {
    if (!c) return;
    if (status !== null && status !== c.status) onChange();
    setStatus(c.status);
  }, [c, status, onChange]);

  const title = c ? t(STATUS_KEY[c.status]) : '';
  const explanation = lang === 'ur' ? c?.decision?.explanationUr : c?.decision?.explanationEn;
  // Arrives later (or never): the engine's sentence above is what is spoken when the card appears.
  const simple = useSimpleExplanation(c);
  const payEvents = c?.timeline.filter((e) => e.type.startsWith('payment.')) ?? [];
  const lastPay = payEvents.at(-1)?.type;
  const wasPaid = payEvents.some((e) => e.type === 'payment.success');
  // A closed claim that was paid keeps its receipt.
  const paid =
    c && c.amount != null && (c.status === 'PAID' || (c.status === 'CLOSED' && wasPaid))
      ? c.amount
      : null;
  const payProblem: MessageKey | null =
    c?.status !== 'APPROVED'
      ? null
      : lastPay === 'payment.failed'
        ? 'payProblemFailed'
        : lastPay === 'payment.held'
          ? 'payProblemHeld'
          : lastPay === 'payment.unknown'
            ? 'payProblemUnknown'
            : null;
  const amount = useAmountText(paid ?? 0);

  // Speak the latest status once when it appears (and again only if the status itself changes).
  const spoken = useRef('');
  useEffect(() => {
    if (!c || spoken.current === `${c.id}:${c.status}`) return;
    spoken.current = `${c.id}:${c.status}`;
    // NEEDS_INFO is spoken by its own panel, together with the officer's question.
    if (c.status === 'NEEDS_INFO') return;
    const receipt =
      paid != null ? ` ${t('receiptTitle')}. ${amount.spoken}. ${t('receiptLine')}` : '';
    speak(`${title}. ${explanation ?? ''}${receipt}`);
  }, [c, paid, title, explanation, amount.spoken, speak, t]);

  if (loading && !c) return <Skeleton lines={2} />;
  // A failed background refresh keeps the last good card instead of replacing it with an error.
  if (error && !c) return <ErrorState error={error} onRetry={reload} />;
  if (!c) return null;

  return (
    <div className="space-y-4">
      <StatusCard
        tone={STATUS_TONE[c.status] ?? 'info'}
        title={title}
        body={simple ?? explanation}
      />
      {simple && <SimpleWordsLabel />}
      {payProblem && (
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <StatusCard tone="warn" title={t('payProblemTitle')} body={t(payProblem)} />
          </div>
          <AudioButton text={[t('payProblemTitle'), t(payProblem)]} className="text-brand" />
        </div>
      )}
      {paid != null && <HaqReceipt amount={paid} caseId={c.id} />}
      {c.status === 'IN_REVIEW' && <StatusCard tone="info" title={t('waitingOfficer')} />}
      {c.status === 'NEEDS_INFO' && (
        <NeedsInfo c={c} lead={[title, explanation ?? '']} onResent={reload} />
      )}
      <Timeline
        lang={lang}
        events={timelineRows(c.timeline, t)}
        done={c.status === 'PAID' || c.status === 'CLOSED' || c.status === 'REJECTED'}
      />
    </div>
  );
}

export function ClaimStatus() {
  const { t, lang } = useI18n();
  const { data, error, loading, reload } = useAsync(() => api.cases(), []);
  const [open, setOpen] = useState<string | null>(null);
  const latest = open ?? data?.[0]?.id ?? null;

  return (
    <CitizenShell>
      <Link
        replace
        href="/citizen"
        className="mb-4 inline-flex min-h-12 min-w-12 items-center px-2 text-brand underline"
      >
        {t('back')}
      </Link>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">{t('status')}</h1>
        <AudioButton text={t('status')} className="text-brand" />
      </div>
      <RefusedClaims />
      {loading && !data ? (
        <Skeleton lines={2} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data?.length ? (
        <EmptyState
          title={t('noClaims')}
          action={<LinkButton href="/citizen/claim">{t('claim')}</LinkButton>}
        />
      ) : (
        <div className="space-y-4">
          {latest && <CaseCard key={latest} id={latest} onChange={reload} />}
          {data.length > 1 && (
            <nav aria-label={t('claimsList')} className="space-y-2">
              <p className="text-lg font-semibold">{t('claimsList')}</p>
              <div className="flex flex-wrap gap-2">
                {data.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-current={c.id === latest}
                    onClick={() => setOpen(c.id)}
                    className={`min-h-12 rounded-xl border-2 px-3 ${c.id === latest ? 'border-brand bg-brand-soft' : 'border-slate-300 bg-white'}`}
                  >
                    <span className={`text-sm ${lang === 'en' ? 'latin' : ''}`}>
                      {new Date(c.createdAt).toLocaleDateString(lang === 'ur' ? 'ur-PK' : 'en-PK')}
                    </span>
                    {' · '}
                    {t(CHIP_KEY[c.status])}
                  </button>
                ))}
              </div>
            </nav>
          )}
        </div>
      )}
    </CitizenShell>
  );
}
