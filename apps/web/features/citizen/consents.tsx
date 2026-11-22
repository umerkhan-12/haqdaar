'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ComponentType, type SVGProps } from 'react';
import { CitizenShell } from '@/components/citizen-shell';
import {
  IconCheck,
  IconLock,
  IconSearch,
  IconShield,
  IconUsers,
  IconWallet,
  IconX,
} from '@/components/icons';
import { AudioButton, Button, ErrorState, Skeleton, StatusCard } from '@/components/ui';
import { api, type Consent, type CorrectionField } from '@/lib/api';
import { useAsync, useSession } from '@/lib/hooks';
import { HelperLinkCard } from './helper-link';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { purposeText, REQUIRED_PURPOSES } from './consent-purposes';

interface PurposeState {
  purpose: string;
  /** Every ACTIVE row: a purpose can be granted more than once, and all of them must be withdrawn. */
  activeIds: string[];
  /** When the current state began: the latest grant if given, else the latest withdrawal. */
  since: string | null;
  everGiven: boolean;
}

const latest = (dates: (string | null)[]): string | null =>
  dates.reduce<string | null>((max, d) => (d && (!max || d > max) ? d : max), null);

/** One card per purpose: the two a claim needs are always listed, others only if she ever gave them. */
function byPurpose(consents: Consent[]): PurposeState[] {
  const purposes = [...new Set([...REQUIRED_PURPOSES, ...consents.map((c) => c.purpose)])];
  return purposes.map((purpose) => {
    const rows = consents.filter((c) => c.purpose === purpose);
    const active = rows.filter((c) => c.status === 'ACTIVE');
    return {
      purpose,
      activeIds: active.map((c) => c.id),
      since: active.length
        ? latest(active.map((c) => c.grantedAt))
        : latest(rows.map((c) => c.withdrawnAt)),
      everGiven: rows.length > 0,
    };
  });
}

function ConsentCard({
  state,
  confirming,
  busy,
  onAskTakeBack,
  onCancel,
  onTakeBack,
  onGive,
}: {
  state: PurposeState;
  confirming: boolean;
  busy: boolean;
  onAskTakeBack: () => void;
  onCancel: () => void;
  onTakeBack: () => void;
  onGive: () => void;
}) {
  const { t, lang } = useI18n();
  const text = purposeText(state.purpose);
  const given = state.activeIds.length > 0;
  const stateText = t(given ? 'cGiven' : state.everGiven ? 'cTakenBack' : 'cNever');
  const StateIcon = given ? IconCheck : IconX;
  const consequence = `${t('takeBackAsk')} ${t(text.consequence)}`;

  return (
    <section className="space-y-3 rounded-2xl border-2 border-slate-300 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-dark">
          <IconLock className="h-6 w-6" />
        </span>
        <div className="flex-1">
          <h2 className="text-xl font-bold">{t(text.who)}</h2>
          <p className="mt-1 text-lg">{t(text.why)}</p>
        </div>
        <AudioButton text={`${t(text.who)}. ${t(text.why)}. ${stateText}`} className="text-brand" />
      </div>

      <p
        className={`flex items-center gap-2 text-lg font-semibold ${given ? 'text-green-800' : 'text-red-800'}`}
      >
        <StateIcon className="h-6 w-6 shrink-0" />
        <span className="flex-1">{stateText}</span>
        {state.since && (
          <time className="text-base font-normal text-muted" dateTime={state.since}>
            {new Date(state.since).toLocaleDateString(lang === 'ur' ? 'ur-PK' : 'en-PK', {
              dateStyle: 'medium',
            })}
          </time>
        )}
      </p>

      {confirming ? (
        <div
          role="alert"
          className="space-y-3 rounded-xl border-2 border-amber-700 bg-amber-50 p-3 text-amber-900"
        >
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <p className="text-lg font-bold">{t('takeBackAsk')}</p>
              <p className="mt-1">{t(text.consequence)}</p>
            </div>
            <AudioButton text={consequence} />
          </div>
          <Button variant="danger" className="w-full" disabled={busy} onClick={onTakeBack}>
            {t('yesTakeBack')}
          </Button>
          <Button variant="ghost" className="w-full" disabled={busy} onClick={onCancel}>
            {t('noKeep')}
          </Button>
        </div>
      ) : given ? (
        <Button variant="danger" className="w-full" disabled={busy} onClick={onAskTakeBack}>
          {t('takeBack')}
        </Button>
      ) : (
        <Button className="w-full" disabled={busy} onClick={onGive}>
          {t(state.everGiven ? 'giveAgain' : 'givePermission')}
        </Button>
      )}
    </section>
  );
}

const FIELDS: {
  field: CorrectionField;
  label: MessageKey;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}[] = [
  { field: 'name', label: 'fixName', icon: IconUsers },
  { field: 'cnic', label: 'fixCnic', icon: IconShield },
  { field: 'district', label: 'fixDistrict', icon: IconSearch },
  { field: 'household', label: 'fixHousehold', icon: IconWallet },
];

/**
 * "My information is wrong": she picks what is wrong with one tap; an officer corrects it after
 * checking. Verified identity data is never edited from the phone, so a stolen phone cannot rewrite it.
 */
function CorrectionForm() {
  const { t, speak } = useI18n();
  const [field, setField] = useState<CorrectionField | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function send() {
    if (!field) return;
    setBusy(true);
    setError(null);
    try {
      await api.requestCorrection(field, note.trim() || undefined);
      setSent(true);
      setField(null);
      setNote('');
      speak(t('fixSent'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border-2 border-slate-300 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h2 className="text-xl font-bold">{t('fixTitle')}</h2>
          <p className="mt-1 text-lg">{t('fixIntro')}</p>
        </div>
        <AudioButton
          text={`${t('fixTitle')}. ${t('fixIntro')} ${t('fixChoose')}`}
          className="text-brand"
        />
      </div>

      {sent && <StatusCard tone="ok" title={t('fixSent')} />}
      {error ? <ErrorState error={error} /> : null}

      <fieldset className="space-y-2">
        <legend className="text-lg font-semibold">{t('fixChoose')}</legend>
        <div className="grid grid-cols-2 gap-3">
          {FIELDS.map(({ field: f, label, icon: Icon }) => (
            <button
              key={f}
              type="button"
              aria-pressed={field === f}
              onClick={() => {
                setField(f);
                setSent(false);
                speak(t(label));
              }}
              className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border-2 p-3 text-center text-lg font-semibold ${
                field === f
                  ? 'border-brand bg-brand-soft text-brand-dark'
                  : 'border-slate-300 bg-white'
              }`}
            >
              <Icon className="h-8 w-8" />
              {t(label)}
            </button>
          ))}
        </div>
      </fieldset>

      {field && (
        <>
          <label className="block space-y-1">
            <span className="text-base font-medium">{t('fixNote')}</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={280}
              rows={2}
              className="min-h-24 w-full rounded-xl border-2 border-slate-400 bg-white p-3 text-lg text-ink focus:border-brand"
            />
          </label>
          <Button className="w-full" disabled={busy} onClick={send}>
            {t('fixSend')}
          </Button>
        </>
      )}
    </section>
  );
}

/**
 * "My data and permission": who sees what and why, in plain words and by voice; she can take a
 * permission back (after hearing what that does) and give it again. Also works for a helper acting
 * for a family: the session's person is the family, never the helper.
 */
export function MyConsents() {
  const { t, speak } = useI18n();
  const session = useSession();
  const { data, error, loading, reload } = useAsync(() => api.consents(), []);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MessageKey | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const summary = `${t('myData')}. ${t('myDataIntro')}`;

  const spoken = useRef(false);
  useEffect(() => {
    if (!data || spoken.current) return;
    spoken.current = true;
    speak(summary);
  }, [data, speak, summary]);

  /** Runs one change, then tells her the result in words and by voice. */
  async function change(work: () => Promise<unknown>, done: MessageKey) {
    setBusy(true);
    setActionError(null);
    setResult(null);
    try {
      await work();
      setResult(done);
      speak(t(done));
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
      setConfirming(null);
      reload();
    }
  }

  const takeBack = (s: PurposeState) =>
    change(async () => {
      for (const id of s.activeIds) await api.withdrawConsent(id);
    }, 'takenBackDone');

  const give = (s: PurposeState) => {
    const personId = session?.personId;
    if (!personId) return;
    void change(() => api.grantConsent(personId, s.purpose), 'givenDone');
  };

  return (
    <CitizenShell>
      <Link
        replace
        href="/citizen"
        className="mb-4 inline-flex min-h-12 min-w-12 items-center px-2 text-brand underline"
      >
        {t('back')}
      </Link>
      <div className="mb-2 flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">{t('myData')}</h1>
        <AudioButton text={summary} className="text-brand" />
      </div>
      <p className="mb-4 text-lg">{t('myDataIntro')}</p>

      {loading && !data ? (
        <Skeleton lines={3} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <div className="space-y-4">
          {result && <StatusCard tone={result === 'givenDone' ? 'ok' : 'warn'} title={t(result)} />}
          {actionError ? <ErrorState error={actionError} /> : null}
          {byPurpose(data ?? []).map((s) => (
            <ConsentCard
              key={s.purpose}
              state={s}
              confirming={confirming === s.purpose}
              busy={busy}
              onAskTakeBack={() => {
                setConfirming(s.purpose);
                speak(`${t('takeBackAsk')} ${t(purposeText(s.purpose).consequence)}`);
              }}
              onCancel={() => setConfirming(null)}
              onTakeBack={() => void takeBack(s)}
              onGive={() => give(s)}
            />
          ))}
          <CorrectionForm />
          <HelperLinkCard />
        </div>
      )}
    </CitizenShell>
  );
}
