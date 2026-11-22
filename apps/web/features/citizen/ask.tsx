'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CitizenShell } from '@/components/citizen-shell';
import { IconMic, IconStop } from '@/components/icons';
import { AudioButton, Button, ErrorState, Skeleton, StatusCard } from '@/components/ui';
import { api, type AssistAnswer, type AssistStep } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';

/** Long enough for one question; a forgotten microphone stops by itself. */
const MAX_RECORDING_MS = 30_000;

const SUGGESTED: MessageKey[] = ['askQ1', 'askQ2', 'askQ3', 'askQ4', 'askQ5', 'askQ6'];

const TOOL_LABEL: Record<AssistStep['tool'], MessageKey> = {
  searchPolicy: 'askToolPolicy',
  getMyClaims: 'askToolClaims',
  getMyPayments: 'askToolPayments',
  checkMessage: 'askToolMessage',
};

/** One spoken sentence at a time: each piece is short enough for the server voice and caches well. */
const sentences = (text: string) =>
  text
    .split(/(?<=[.!?؟۔])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * "Ask about the program": she asks by voice, by tapping a ready question, or by typing.
 * The answer is spoken and shown with the documents it came from; when the assistant is not sure
 * it says so and sends her to a helper or an officer instead of guessing.
 */
export function AskProgram() {
  const { t, speak, lang } = useI18n();
  const [typed, setTyped] = useState('');
  const [asked, setAsked] = useState('');
  const [answer, setAnswer] = useState<AssistAnswer | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notHeard, setNotHeard] = useState(false);
  const [busy, setBusy] = useState<'' | 'recording' | 'thinking'>('');
  const recorder = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    speak([t('askTitle'), t('askHint')]);
    // Speak once when the screen opens or the language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  async function ask(question: string) {
    const q = question.trim();
    if (q.length < 2) return;
    setAsked(q);
    setAnswer(null);
    setError(null);
    setNotHeard(false);
    setBusy('thinking');
    try {
      const a = await api.assist(q, lang);
      setAnswer(a);
      // Sentence by sentence; a "not sure" answer already ends with who to ask instead.
      speak(sentences(a.answer));
    } catch (e) {
      setError(e);
    } finally {
      setBusy('');
    }
  }

  async function startRecording() {
    setError(null);
    setNotHeard(false);
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
        void heard(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      };
      rec.start();
      recorder.current = rec;
      setBusy('recording');
    } catch {
      // No microphone or permission refused: the ready questions and typing still work.
      sayNotHeard();
    }
  }

  function stopRecording() {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }

  async function heard(audio: Blob) {
    setBusy('thinking');
    try {
      const said = await api.transcribe(audio);
      if (!said.understood) return sayNotHeard();
      await ask(said.text);
    } catch {
      sayNotHeard();
    }
  }

  function sayNotHeard() {
    setBusy('');
    setNotHeard(true);
    speak(t('askNotHeard'));
  }

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
        <h1 className="flex-1 text-2xl font-bold">{t('askTitle')}</h1>
        <AudioButton text={[t('askTitle'), t('askHint')]} className="text-brand" />
      </div>
      <p className="mb-4 text-lg text-muted">{t('askHint')}</p>

      <div className="text-center">
        <button
          type="button"
          onClick={busy === 'recording' ? stopRecording : startRecording}
          disabled={busy === 'thinking'}
          aria-label={busy === 'recording' ? t('recordStop') : t('askHint')}
          aria-pressed={busy === 'recording'}
          className={`mx-auto grid h-36 w-36 select-none place-items-center rounded-full text-white shadow-lg disabled:opacity-50 ${
            busy === 'recording' ? 'bg-red-600 motion-safe:animate-pulse' : 'bg-brand'
          }`}
        >
          {busy === 'recording' ? (
            <IconStop className="h-16 w-16" />
          ) : (
            <IconMic className="h-16 w-16" />
          )}
        </button>
        <p className="mt-2 min-h-8 text-xl font-semibold text-red-700" aria-live="polite">
          {busy === 'recording' ? `${t('recording')} ${t('recordStop')}` : ''}
        </p>
      </div>

      <div className="mt-2 space-y-4" aria-live="polite">
        {busy === 'thinking' && (
          <div role="status" className="space-y-2">
            <p className="text-xl font-semibold">{t('askThinking')}</p>
            <Skeleton lines={2} />
          </div>
        )}
        {notHeard && <StatusCard tone="warn" title={t('askNotHeard')} />}
        {error ? <ErrorState error={error} onRetry={() => ask(asked)} /> : null}
        {answer && (
          <section aria-label={t('askAnswer')} className="space-y-3">
            <p className="text-muted">
              {t('askYouAsked')}: <span className="font-semibold text-slate-900">{asked}</span>
            </p>
            {answer.refused ? (
              <StatusCard
                tone="warn"
                title={t('askNotSure')}
                body={answer.answer || t('askNotSureBody')}
              />
            ) : (
              <StatusCard
                tone={answer.scam === 'SCAM' ? 'bad' : 'ok'}
                title={t('askAnswer')}
                body={answer.answer}
                urgent={answer.scam === 'SCAM'}
              />
            )}
            {answer.steps.length > 0 && (
              <div>
                <p className="mb-1 text-sm font-semibold text-muted">{t('askChecked')}</p>
                <ul className="flex flex-wrap gap-2">
                  {answer.steps.map((s, i) => (
                    <li
                      key={`${s.tool}-${i}`}
                      className={`rounded-full border-2 px-3 py-1 text-sm font-medium ${
                        s.ok
                          ? 'border-emerald-700 bg-emerald-50 text-emerald-900'
                          : 'border-slate-400 bg-slate-100 text-slate-700'
                      }`}
                    >
                      {s.ok ? '✓' : '✕'} {t(TOOL_LABEL[s.tool])}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {answer.sources.length > 0 && (
              <div>
                <p className="mb-1 text-sm font-semibold text-muted">{t('askSources')}</p>
                <ul className="space-y-2">
                  {answer.sources.map((c) => (
                    <li
                      key={`${c.docId}-${c.heading}-${c.quote.slice(0, 24)}`}
                      className="rounded-xl border border-slate-300 bg-white p-3 text-sm"
                    >
                      <p className="font-semibold" dir="ltr">
                        {c.docId} · {c.heading}
                      </p>
                      <p className="mt-1 text-slate-700">“{c.quote}”</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>

      <ul className="mt-6 space-y-3">
        {SUGGESTED.map((k) => (
          <li key={k}>
            <button
              type="button"
              onClick={() => ask(t(k))}
              disabled={busy !== ''}
              className="flex min-h-16 w-full items-center rounded-2xl border-2 border-brand bg-white px-5 text-start text-xl font-semibold text-brand-dark disabled:opacity-50"
            >
              {t(k)}
            </button>
          </li>
        ))}
      </ul>

      <form
        className="mt-6 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(typed);
        }}
      >
        <label className="block space-y-2">
          <span className="text-lg">{t('askType')}</span>
          <textarea
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            rows={3}
            maxLength={1500}
            className="w-full rounded-xl border-2 border-slate-400 bg-white p-3 text-lg"
          />
        </label>
        <Button type="submit" className="w-full" disabled={busy !== '' || typed.trim().length < 2}>
          {t('askSend')}
        </Button>
      </form>
    </CitizenShell>
  );
}
