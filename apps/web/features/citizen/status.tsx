'use client';

import Link from 'next/link';
import { useState } from 'react';
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
import { useAsync } from '@/lib/hooks';
import { useI18n, type MessageKey } from '@/lib/i18n';

const STATUS_TONE: Partial<Record<CaseStatus, 'ok' | 'bad' | 'warn' | 'info'>> = {
  PAID: 'ok',
  APPROVED: 'ok',
  REJECTED: 'bad',
  NEEDS_INFO: 'warn',
  IN_REVIEW: 'info',
};

const EVENT_KEYS = new Set<string>([
  'ev_submitted',
  'ev_decided',
  'ev_approved',
  'ev_rejected',
  'ev_paid',
  'ev_info_requested',
  'ev_consent_withdrawn',
]);

function statusKey(s: CaseStatus): MessageKey {
  const k = `status${s}`;
  return (
    [
      'statusPAID',
      'statusAPPROVED',
      'statusIN_REVIEW',
      'statusNEEDS_INFO',
      'statusREJECTED',
    ].includes(k)
      ? k
      : 'statusSUBMITTED'
  ) as MessageKey;
}

/** Haq Receipt: the exact amount, big, spoken, so nobody can quietly keep part of it. */
function HaqReceipt({ amount }: { amount: number }) {
  const { t } = useI18n();
  const text = `${t('receiptTitle')}. ${amount.toLocaleString('en-PK')} ${t('rupees')}. ${t('receiptLine')}`;
  return (
    <div className="rounded-2xl border-4 border-green-700 bg-green-50 p-5 text-center text-green-900">
      <p className="text-lg font-semibold">{t('receiptTitle')}</p>
      <p className="latin my-2 text-5xl font-bold" dir="ltr">
        Rs {amount.toLocaleString('en-PK')}
      </p>
      <p>{t('receiptLine')}</p>
      <div className="mt-3 flex justify-center">
        <AudioButton text={text} className="text-green-800" />
      </div>
    </div>
  );
}

function CaseCard({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const eventLabel = (type: string) => {
    const k = `ev_${type}` as MessageKey;
    return EVENT_KEYS.has(k) ? t(k) : type.replace(/_/g, ' ');
  };
  const { data: c, error, loading, reload } = useAsync<CaseDetail>(() => api.case(id), [id]);
  const [resending, setResending] = useState(false);
  if (loading && !c) return <Skeleton lines={2} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!c) return null;

  const explanation = lang === 'ur' ? c.decision?.explanationUr : c.decision?.explanationEn;
  return (
    <div className="space-y-4">
      <StatusCard
        tone={STATUS_TONE[c.status] ?? 'info'}
        title={t(statusKey(c.status))}
        body={explanation}
      />
      {c.status === 'PAID' && <HaqReceipt amount={c.amount ?? 12000} />}
      {c.status === 'IN_REVIEW' && <StatusCard tone="info" title={t('waitingOfficer')} />}
      {c.status === 'NEEDS_INFO' && (
        <Button
          className="w-full"
          disabled={resending}
          onClick={async () => {
            setResending(true);
            await api.resubmit(c.id).catch(() => undefined);
            setResending(false);
            reload();
          }}
        >
          {t('resubmit')}
        </Button>
      )}
      <Timeline events={c.timeline.map((e) => ({ label: eventLabel(e.type), at: e.at }))} />
    </div>
  );
}

export function ClaimStatus() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useAsync(() => api.cases(), []);
  const [open, setOpen] = useState<string | null>(null);
  const latest = open ?? data?.[0]?.id ?? null;

  return (
    <CitizenShell>
      <Link
        href="/citizen"
        className="mb-4 inline-flex min-h-12 min-w-12 items-center px-2 text-brand underline"
      >
        {t('back')}
      </Link>
      <h1 className="mb-4 text-2xl font-bold">{t('status')}</h1>
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
          {latest && <CaseCard id={latest} />}
          {data.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {data.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setOpen(c.id)}
                  className={`latin min-h-12 rounded-xl border-2 px-3 text-sm ${c.id === latest ? 'border-brand bg-brand-soft' : 'border-slate-300 bg-white'}`}
                  dir="ltr"
                >
                  {new Date(c.createdAt).toLocaleDateString('en-PK')} · {c.status}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </CitizenShell>
  );
}
