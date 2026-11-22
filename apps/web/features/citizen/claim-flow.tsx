'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ComponentType, type SVGProps } from 'react';
import { CitizenShell } from '@/components/citizen-shell';
import { IconCheck, IconIdCard, IconLock, IconMic, IconStop, IconX } from '@/components/icons';
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
import {
  api,
  ApiError,
  type CaseDetail,
  type ClaimInput,
  type DocumentCheck,
  type Extraction,
} from '@/lib/api';
import { useSession } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { enqueue } from '@/lib/outbox';
import { ownPhone } from '@/lib/session';
import {
  DISTRICTS,
  districtLabel,
  EMPTY,
  firstMissing,
  formatCnic,
  isValid,
  mergeHeard,
  spellDigits,
  type Details,
  type FieldName,
} from './claim-words';
import { CnicPhoto } from './cnic-photo';
import { SimpleWordsLabel, useSimpleExplanation } from './simple-explanation';

/** speak → card photo → review (yes / no) → consent → done; `edit` is the typed fallback, reachable from anywhere. */
type Step = 'speak' | 'review' | 'edit' | 'photo' | 'consent' | 'done';

const CONSENTS = [
  { purpose: 'identity_verification', label: 'consentIdentity' },
  { purpose: 'household_data', label: 'consentHousehold' },
] as const;

const QUESTION: Record<FieldName, MessageKey> = {
  fullName: 'askFullName',
  cnic: 'askCnic',
  district: 'askDistrict',
  householdSize: 'askHousehold',
  alias: 'askAlias',
};
const LABEL: Record<FieldName, MessageKey> = {
  fullName: 'fullName',
  cnic: 'cnic',
  district: 'district',
  householdSize: 'household',
  alias: 'payoutNumber',
};

const PROGRESS: {
  steps: Step[];
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: MessageKey;
}[] = [
  { steps: ['speak'], icon: IconMic, label: 'stepSpeak' },
  { steps: ['photo'], icon: IconIdCard, label: 'stepCard' },
  { steps: ['review', 'edit'], icon: IconCheck, label: 'stepCheck' },
  { steps: ['consent'], icon: IconLock, label: 'stepAllow' },
];

/** The same question is asked at most twice; after that she types or a helper does. Never a loop. */
const MAX_TRIES = 2;
/** A recording stops by itself, so a forgotten microphone never runs on. */
const MAX_RECORDING_MS = 45_000;
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

interface Draft {
  details: Details;
  step: Step;
  /** Whether the card step was already passed, so a resumed claim does not ask for the photo twice. */
  cardSeen?: boolean;
  savedAt: number;
}
/** What the AI heard, sent with the claim so an officer sees the notes behind every handoff. */
interface Heard {
  transcript: string;
  extraction: Extraction['extraction'];
  needsHuman: boolean;
  reason?: string;
}

const draftKey = (personId: string) => `hq.claim.${personId}`;

function loadDraft(personId: string): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey(personId)) ?? 'null') as Draft | null;
    return d && Date.now() - d.savedAt < DRAFT_TTL_MS ? d : null;
  } catch {
    return null;
  }
}

export function ClaimFlow() {
  const { t, speak, lang } = useI18n();
  const session = useSession();
  const personId = session?.personId ?? null;
  const [step, setStep] = useState<Step>('speak');
  const [details, setDetails] = useState<Details>(EMPTY);
  /** The one thing being asked for right now; null = "tell us everything". */
  const [asking, setAsking] = useState<FieldName | null>(null);
  const [aiUnsure, setAiUnsure] = useState(false);
  const [restored, setRestored] = useState(false);
  const [documentCheck, setDocumentCheck] = useState<DocumentCheck | null>(null);
  /** The card step is passed once (scanned or skipped); later corrections do not ask for it again. */
  const [cardSeen, setCardSeen] = useState(false);
  // Consent must be an explicit act: nothing is pre-ticked.
  const [consents, setConsents] = useState<string[]>([]);
  const [result, setResult] = useState<
    { kind: 'sent'; case: CaseDetail } | { kind: 'saved' } | null
  >(null);
  // Simpler wording of the decision, if the AI has one; the result itself never waits for it.
  const simple = useSimpleExplanation(result?.kind === 'sent' ? result.case : null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<'' | 'recording' | 'understanding' | 'sending'>('');
  const key = useRef(crypto.randomUUID());
  const recorder = useRef<MediaRecorder | null>(null);
  const tries = useRef<Partial<Record<FieldName | 'open', number>>>({});
  const heard = useRef<Heard[]>([]);

  // Memory across sessions: what she already said survives a dropped call, a closed tab or a dead battery.
  useEffect(() => {
    if (!personId) return;
    const draft = loadDraft(personId);
    if (draft) {
      setDetails(draft.details);
      setCardSeen(!!draft.cardSeen);
      // Mid-conversation: pick up at the next thing we still need instead of starting the questions over.
      if (draft.step === 'speak') setAsking(firstMissing(draft.details));
      setStep(draft.step);
      setRestored(true);
    } else if (session?.role === 'citizen' && isValid.alias(ownPhone())) {
      // Her relief money goes to the phone she signed in with unless she says another number.
      setDetails((d) => ({ ...d, alias: ownPhone() }));
    }
  }, [personId, session?.role]);

  useEffect(() => {
    // Nothing worth keeping until she has told us something beyond the phone number we already knew.
    const told = details.fullName || details.cnic || details.district || details.householdSize;
    if (!personId || step === 'done' || !told) return;
    localStorage.setItem(
      draftKey(personId),
      JSON.stringify({ details, step, cardSeen, savedAt: Date.now() } satisfies Draft),
    );
  }, [personId, details, step, cardSeen]);

  const value = useCallback(
    (f: FieldName, d: Details): string =>
      f === 'district'
        ? districtLabel(d[f], lang)
        : f === 'cnic' || f === 'alias'
          ? spellDigits(d[f])
          : d[f],
    [lang],
  );
  const readBack = useCallback(
    (d: Details): string[] => [
      t('reviewTitle'),
      ...(Object.keys(LABEL) as FieldName[])
        .filter((f) => d[f])
        .map((f) => `${t(LABEL[f])}: ${value(f, d)}`),
      t('reviewAsk'),
    ],
    [t, value],
  );

  // Every step says what to do as soon as it appears: the screen is usable without reading a word.
  useEffect(() => {
    if (!personId) return;
    if (step === 'speak') speak(asking ? t(QUESTION[asking]) : [t('recordTap'), t('recordHint')]);
    else if (step === 'review')
      speak(restored ? [t('draftRestored'), ...readBack(details)] : readBack(details));
    else if (step === 'edit') speak(t(aiUnsure ? 'typeOrHelper' : 'checkDetails'));
    else if (step === 'consent')
      speak([t('consentAsk'), ...CONSENTS.map((c) => t(c.label)), t('consentNote')]);
    // Speak once per step / question, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, asking, personId, lang]);

  const set = (k: FieldName) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDetails((d) => ({ ...d, [k]: k === 'cnic' ? formatCnic(e.target.value) : e.target.value }));

  async function startRecording() {
    setError(null);
    speak([]);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      const limit = setTimeout(() => rec.state === 'recording' && rec.stop(), MAX_RECORDING_MS);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        clearTimeout(limit);
        stream.getTracks().forEach((tr) => tr.stop());
        void understand(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      };
      rec.start();
      recorder.current = rec;
      setBusy('recording');
    } catch {
      // No microphone or permission refused: typing still finishes the claim.
      goManual();
    }
  }

  function stopRecording() {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }

  async function understand(audio: Blob) {
    setBusy('understanding');
    try {
      const said = await api.transcribe(audio);
      if (!said.understood) return notUnderstood();
      const ex = await api.extract(said.text);
      heard.current.push({
        transcript: said.text,
        extraction: ex.extraction,
        needsHuman: ex.needsHuman,
        reason: ex.reason,
      });
      if (ex.needsHuman) setAiUnsure(true);
      const next = mergeHeard(details, ex.extraction, said.text, asking);
      setDetails(next);
      askNext(next);
    } catch {
      goManual();
    } finally {
      setBusy('');
    }
  }

  /** Ask only for what is still missing. The next question is chosen by code, never by the model. */
  function askNext(d: Details) {
    const missing = firstMissing(d);
    if (!missing) {
      setAsking(null);
      return setStep(cardSeen ? 'review' : 'photo');
    }
    const count = (tries.current[missing] ?? 0) + 1;
    tries.current[missing] = count;
    if (count > MAX_TRIES) return goManual();
    if (missing === asking) speak([t('notHeard'), t(QUESTION[missing])]);
    setAsking(missing);
  }

  function notUnderstood() {
    const slot = asking ?? 'open';
    const count = (tries.current[slot] ?? 0) + 1;
    tries.current[slot] = count;
    if (count >= MAX_TRIES) return goManual();
    speak([t('notHeard'), t(asking ? QUESTION[asking] : 'recordHint')]);
  }

  /** AI off, unsure, or no microphone: she (or a helper) types. The claim is flagged for a human, never dropped. */
  function goManual() {
    setBusy('');
    setAiUnsure(true);
    setAsking(null);
    setStep('edit');
  }

  function startOver() {
    if (personId) localStorage.removeItem(draftKey(personId));
    tries.current = {};
    heard.current = [];
    setDetails(
      session?.role === 'citizen' && isValid.alias(ownPhone())
        ? { ...EMPTY, alias: ownPhone() }
        : EMPTY,
    );
    setAsking(null);
    setAiUnsure(false);
    setRestored(false);
    setDocumentCheck(null);
    setCardSeen(false);
    setStep('speak');
  }

  /**
   * The card is the official record: when the photo passes every check, its printed number and name
   * replace what was heard, so a misheard spelling ("Jainab") cannot reach the claim. A card that looks
   * edited or unclear changes nothing here; it goes to an officer with the claim instead.
   */
  function afterCard(check: DocumentCheck | null) {
    setDocumentCheck(check);
    setCardSeen(true);
    let next = details;
    if (check && !check.needsHuman && !check.retakeRequired) {
      const cnic = formatCnic(check.cnicFromQr ?? check.cnicFromOcr ?? '');
      // Cards print names in capitals (ZAINAB BIBI); the claim keeps the same letters in ordinary case.
      const name = (check.fields?.name ?? '')
        .trim()
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
      next = {
        ...details,
        ...(isValid.cnic(cnic) ? { cnic } : {}),
        ...(isValid.fullName(name) ? { fullName: name } : {}),
      };
      setDetails(next);
    }
    const missing = firstMissing(next);
    if (!missing) return setStep('review');
    // Scanned first: now ask aloud only for what the card cannot tell us.
    if ((tries.current[missing] ?? 0) >= MAX_TRIES) return goManual();
    tries.current[missing] = (tries.current[missing] ?? 0) + 1;
    setAsking(missing);
    setStep('speak');
  }

  /** The AI's notes for the officer: everything it heard, its last reading, and whether it was sure. */
  function aiNotes(): ClaimInput['extraction'] {
    // A claim she simply typed carries no AI notes: typing is not doubt, and must not cost her a review.
    const last = heard.current.at(-1);
    if (!last) return undefined;
    // She answers in several short turns (name, then number, then district): the officer must see
    // everything that was understood across all of them, not only the last turn. A later answer
    // replaces an earlier one for the same field; the lowest confidence of any turn is kept.
    const all = heard.current.map((h) => h.extraction).filter((x) => x != null);
    const pick = <
      K extends 'fullName' | 'cnic' | 'phone' | 'district' | 'householdSize' | 'isWidow',
    >(
      k: K,
    ) => all.map((x) => x[k]).findLast((v) => v != null && v !== '') ?? null;
    const merged = all.length
      ? {
          ...all.at(-1)!,
          intent: all.find((x) => x.intent && x.intent !== 'other')?.intent ?? all.at(-1)!.intent,
          fullName: pick('fullName'),
          cnic: pick('cnic'),
          phone: pick('phone'),
          district: pick('district'),
          householdSize: pick('householdSize'),
          isWidow: pick('isWidow'),
          confidence: Math.min(...all.map((x) => x.confidence)),
        }
      : null;
    if (merged) {
      merged.missingFields = (['fullName', 'cnic', 'district', 'householdSize'] as const).filter(
        (k) => merged[k] == null,
      );
    }
    return {
      ...(merged ?? {}),
      transcript: heard.current.map((h) => h.transcript).join(' | '),
      needsHuman: heard.current.some((h) => h.needsHuman),
      reason: heard.current.find((h) => h.reason)?.reason,
    };
  }

  async function send() {
    if (!personId) return;
    const claim: ClaimInput = {
      type: 'relief_claim',
      fullName: details.fullName.trim(),
      cnic: details.cnic,
      district: details.district || undefined,
      householdSize: details.householdSize ? Number(details.householdSize) : undefined,
      payout: { alias: details.alias },
      extraction: aiNotes(),
      documentCheck,
    };
    setBusy('sending');
    setError(null);
    try {
      if (!navigator.onLine) throw new ApiError(0, 'offline');
      for (const purpose of consents) await api.grantConsent(personId, purpose);
      const c = await api.submitClaim(claim, key.current);
      localStorage.removeItem(draftKey(personId));
      if (details.district) localStorage.setItem('hq.district', details.district);
      setResult({ kind: 'sent', case: c });
      setStep('done');
      const reason = lang === 'ur' ? c.decision?.explanationUr : c.decision?.explanationEn;
      speak([
        t(`lane${c.lane ?? 'HUMAN_REVIEW'}` as MessageKey),
        reason ?? '',
        c.lane === 'AUTO_APPROVE' ? '' : t('waitingOfficer'),
      ]);
    } catch (e) {
      if (e instanceof ApiError && e.offline) {
        await enqueue({ key: key.current, claim, personId, consents });
        localStorage.removeItem(draftKey(personId));
        setResult({ kind: 'saved' });
        setStep('done');
        speak(t('savedOffline'));
      } else setError(e);
    } finally {
      setBusy('');
    }
  }

  const complete = firstMissing(details) === null;
  const at = PROGRESS.findIndex((p) => p.steps.includes(step));

  return (
    <CitizenShell>
      <Link
        replace
        href="/citizen"
        className="mb-3 inline-flex min-h-12 min-w-12 items-center px-2 text-brand underline"
      >
        {t('back')}
      </Link>

      {step !== 'done' && (
        <ol className="mb-5 flex items-start justify-between gap-1" aria-label={t('claim')}>
          {PROGRESS.map((p, i) => (
            <li
              key={p.label}
              className="flex flex-1 flex-col items-center gap-1 text-center"
              aria-current={i === at ? 'step' : undefined}
            >
              <span
                className={`grid h-12 w-12 place-items-center rounded-full border-2 ${
                  i < at
                    ? 'border-green-700 bg-green-700 text-white'
                    : i === at
                      ? 'border-brand bg-brand text-white'
                      : 'border-slate-300 bg-white text-slate-400'
                }`}
              >
                {i < at ? <IconCheck className="h-6 w-6" /> : <p.icon className="h-6 w-6" />}
              </span>
              <span className={`text-sm ${i === at ? 'font-bold text-brand-dark' : 'text-muted'}`}>
                {t(p.label)}
              </span>
            </li>
          ))}
        </ol>
      )}

      {step === 'speak' && (
        <div className="space-y-6 text-center">
          <div className="flex items-center justify-center gap-3">
            <h1 className="text-2xl font-bold">{asking ? t(QUESTION[asking]) : t('recordTap')}</h1>
            <AudioButton
              text={asking ? t(QUESTION[asking]) : [t('recordTap'), t('recordHint')]}
              className="text-brand"
            />
          </div>
          {!asking && <p className="text-lg text-muted">{t('recordHint')}</p>}
          {busy === 'understanding' ? (
            <div role="status" className="space-y-2">
              <p className="text-xl font-semibold">{t('understanding')}</p>
              <Skeleton lines={2} />
            </div>
          ) : (
            <button
              type="button"
              onClick={busy === 'recording' ? stopRecording : startRecording}
              aria-label={busy === 'recording' ? t('recordStop') : t('recordTap')}
              aria-pressed={busy === 'recording'}
              className={`mx-auto grid h-44 w-44 select-none place-items-center rounded-full text-white shadow-lg ${
                busy === 'recording' ? 'bg-red-600 motion-safe:animate-pulse' : 'bg-brand'
              }`}
            >
              {busy === 'recording' ? (
                <IconStop className="h-20 w-20" />
              ) : (
                <IconMic className="h-20 w-20" />
              )}
            </button>
          )}
          <p className="min-h-8 text-xl font-semibold text-red-700" aria-live="polite">
            {busy === 'recording' ? `${t('recording')} ${t('recordStop')}` : ''}
          </p>
          {!cardSeen && (
            <button
              type="button"
              onClick={() => setStep('photo')}
              disabled={busy !== ''}
              className="flex min-h-20 w-full items-center justify-center gap-3 rounded-2xl border-2 border-brand bg-white px-5 py-2 text-xl font-semibold text-brand-dark disabled:opacity-50"
            >
              <IconIdCard className="h-8 w-8" />
              {t('scanFirst')}
            </button>
          )}
          <Button variant="ghost" onClick={goManual} className="w-full" disabled={busy !== ''}>
            {t('typeInstead')}
          </Button>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <h1 className="flex-1 text-2xl font-bold">{t('reviewTitle')}</h1>
            <AudioButton text={readBack(details)} className="text-brand" />
          </div>
          {restored && <StatusCard tone="info" title={t('draftRestored')} />}
          <dl className="divide-y divide-slate-200 rounded-2xl border-2 border-slate-300 bg-white">
            {(Object.keys(LABEL) as FieldName[]).map((f) => (
              <div key={f} className="flex items-center gap-3 p-4">
                <div className="flex-1">
                  <dt className="text-sm text-muted">{t(LABEL[f])}</dt>
                  <dd
                    className={`text-xl font-semibold ${f === 'cnic' || f === 'alias' || f === 'fullName' ? 'latin' : ''}`}
                    dir="auto"
                  >
                    {f === 'district' ? districtLabel(details[f], lang) : details[f]}
                  </dd>
                </div>
                <AudioButton text={`${t(LABEL[f])}: ${value(f, details)}`} className="text-brand" />
              </div>
            ))}
          </dl>
          <button
            type="button"
            onClick={() => setStep('consent')}
            disabled={!complete}
            className="flex min-h-20 w-full items-center justify-center gap-3 rounded-2xl bg-green-700 px-5 text-xl font-bold text-white disabled:bg-slate-400"
          >
            <IconCheck className="h-9 w-9" />
            {t('yesCorrect')}
          </button>
          <button
            type="button"
            onClick={startOver}
            className="flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl border-2 border-red-700 bg-white px-5 text-xl font-semibold text-red-800"
          >
            <IconX className="h-8 w-8" />
            {t('noSpeakAgain')}
          </button>
          <Button variant="ghost" className="w-full" onClick={() => setStep('edit')}>
            {t('fixByTyping')}
          </Button>
        </div>
      )}

      {step === 'edit' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <h1 className="flex-1 text-2xl font-bold">{t('checkDetails')}</h1>
            <AudioButton
              text={t(aiUnsure ? 'typeOrHelper' : 'checkDetails')}
              className="text-brand"
            />
          </div>
          {aiUnsure && <StatusCard tone="warn" title={t('aiUnsure')} body={t('typeOrHelper')} />}
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
                <option key={d.value} value={d.value}>
                  {lang === 'ur' ? d.ur : d.value}
                </option>
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
          <Button className="w-full" disabled={!complete} onClick={() => setStep('review')}>
            {t('next')}
          </Button>
          <Button variant="ghost" className="w-full" onClick={startOver}>
            {t('startOver')}
          </Button>
        </div>
      )}

      {step === 'photo' && <CnicPhoto cnic={details.cnic} onDone={afterCard} />}

      {step === 'consent' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <IconLock className="h-8 w-8 text-brand" />
            <h1 className="flex-1 text-2xl font-bold">{t('consentTitle')}</h1>
            <AudioButton
              text={[t('consentAsk'), ...CONSENTS.map((c) => t(c.label)), t('consentNote')]}
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
                onClick={() => {
                  setConsents((cs) =>
                    on ? cs.filter((x) => x !== c.purpose) : [...cs, c.purpose],
                  );
                  if (!on) speak(t(c.label));
                }}
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
          <Button className="min-h-16 w-full text-xl" disabled={busy === 'sending'} onClick={send}>
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
                  simple ??
                  (lang === 'ur'
                    ? result.case.decision?.explanationUr
                    : result.case.decision?.explanationEn) ??
                  undefined
                }
              />
              {simple && <SimpleWordsLabel />}
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
