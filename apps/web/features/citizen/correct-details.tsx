'use client';

import { useRef, useState } from 'react';
import { IconMic } from '@/components/icons';
import { AudioButton } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { EMPTY, formatCnic, isValid, mergeHeard, PERSON_NAME } from './claim-words';

export interface Correction {
  fullName: string;
  cnic: string;
}

const MAX_RECORDING_MS = 20_000;

/** What can be sent: an empty box keeps the old value; a filled box must be valid. */
export function correctionReady(c: Correction): boolean {
  const name = c.fullName.trim();
  const nameOk = name === '' || (name.length >= 2 && PERSON_NAME.test(name));
  const cnicOk = c.cnic === '' || isValid.cnic(c.cnic);
  return nameOk && cnicOk && (name !== '' || c.cnic !== '');
}

/**
 * The officer asked for something to be corrected: she types or says her name and card number again.
 * Speech goes through the same transcription and extraction as the claim; she sees and can fix what
 * was heard before anything is sent.
 */
export function CorrectDetails({
  value,
  onChange,
}: {
  value: Correction;
  onChange: (c: Correction) => void;
}) {
  const { t, speak } = useI18n();
  const recorder = useRef<MediaRecorder | null>(null);
  const [state, setState] = useState<'' | 'recording' | 'understanding'>('');
  const [notHeard, setNotHeard] = useState(false);

  async function understand(audio: Blob) {
    setState('understanding');
    try {
      const said = await api.transcribe(audio);
      if (!said.understood) throw new Error('not understood');
      const ex = await api.extract(said.text);
      const next = mergeHeard({ ...EMPTY, ...value }, ex.extraction, said.text, null);
      const heardSomething = next.fullName !== value.fullName || next.cnic !== value.cnic;
      setNotHeard(!heardSomething);
      if (heardSomething) onChange({ fullName: next.fullName, cnic: next.cnic });
      else speak(t('notHeard'));
    } catch {
      setNotHeard(true);
      speak(t('notHeard'));
    } finally {
      setState('');
    }
  }

  async function toggleMic() {
    if (state === 'recording') {
      if (recorder.current?.state === 'recording') recorder.current.stop();
      return;
    }
    speak([]);
    setNotHeard(false);
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
      setState('recording');
    } catch {
      setNotHeard(true); // no microphone: typing still works
    }
  }

  const box = 'mt-1 min-h-14 w-full rounded-xl border-2 border-slate-400 bg-white p-3 text-xl';
  return (
    <div className="space-y-3 rounded-2xl border-2 border-brand bg-brand-soft p-4">
      <div className="flex items-start gap-3">
        <p className="flex-1 text-xl font-bold">{t('redoTitle')}</p>
        <AudioButton text={[t('redoTitle'), t('redoHint')]} className="text-brand" />
      </div>
      <p className="text-lg text-muted">{t('redoHint')}</p>
      <button
        type="button"
        onClick={toggleMic}
        disabled={state === 'understanding'}
        aria-label={t('redoSpeak')}
        className={`flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl text-xl font-bold text-white ${
          state === 'recording' ? 'bg-red-600' : 'bg-brand'
        }`}
      >
        <IconMic className="h-8 w-8" />
        {state === 'recording'
          ? t('redoListening')
          : state === 'understanding'
            ? t('loading')
            : t('redoSpeak')}
      </button>
      {notHeard && <p className="text-lg font-semibold text-amber-800">{t('notHeard')}</p>}
      <label className="block text-lg font-semibold">
        {t('fullName')}
        <input
          className={box}
          dir="auto"
          autoComplete="name"
          value={value.fullName}
          onChange={(e) => onChange({ ...value, fullName: e.target.value.slice(0, 80) })}
        />
      </label>
      <label className="block text-lg font-semibold">
        {t('redoCnic')}
        <input
          className={`${box} latin`}
          dir="ltr"
          inputMode="numeric"
          placeholder="12345-1234567-1"
          value={value.cnic}
          onChange={(e) => onChange({ ...value, cnic: formatCnic(e.target.value) })}
        />
      </label>
      {value.cnic !== '' && !isValid.cnic(value.cnic) && (
        <p className="text-lg font-semibold text-red-700">{t('redoCnicBad')}</p>
      )}
    </div>
  );
}

export function sendableCorrection(
  c: Correction,
): { fullName?: string; cnic?: string } | undefined {
  if (!correctionReady(c)) return undefined;
  return {
    ...(c.fullName.trim() ? { fullName: c.fullName.trim() } : {}),
    ...(c.cnic ? { cnic: c.cnic } : {}),
  };
}
