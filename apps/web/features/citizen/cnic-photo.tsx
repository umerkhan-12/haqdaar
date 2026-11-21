'use client';

import { useEffect, useRef, useState } from 'react';
import { IconCamera } from '@/components/icons';
import { AudioButton, Button, ErrorState, Skeleton, StatusCard } from '@/components/ui';
import { api, type DocumentCheck } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Forgery checks (ELA, EXIF) read the ORIGINAL bytes, so the photo is sent as taken.
 * Only a photo over the 5 MB limit is downscaled, which weakens those checks but keeps the flow going.
 */
async function withinLimit(file: File): Promise<Blob> {
  if (file.size <= MAX_BYTES) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.sqrt((MAX_BYTES * 0.8) / file.size);
  const canvas = new OffscreenCanvas(
    Math.round(bitmap.width * scale),
    Math.round(bitmap.height * scale),
  );
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
}

/** CNIC photo step. It can ask for a retake or hand the card to an officer, but never blocks the claim. */
export function CnicPhoto({
  cnic,
  onDone,
}: {
  cnic: string;
  onDone: (result: DocumentCheck | null) => void;
}) {
  const { t, lang, speak } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DocumentCheck | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function check(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.documentCheck(await withinLimit(file), cnic || undefined);
      setResult(r);
      speak([
        t(r.retakeRequired ? 'photoRetake' : r.needsHuman ? 'photoOfficer' : 'photoOk'),
        (lang === 'ur' ? r.explanationUr : r.explanationEn) ?? '',
      ]);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const reason = result && (lang === 'ur' ? result.explanationUr : result.explanationEn);
  const take = () => input.current?.click();

  // She hears what to do the moment this step opens.
  useEffect(() => {
    speak([t('photoTitle'), t('photoHint')]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">{t('photoTitle')}</h1>
        <AudioButton text={[t('photoTitle'), t('photoHint')]} className="text-brand" />
      </div>
      <p className="text-lg text-muted">{t('photoHint')}</p>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        className="sr-only"
        aria-label={t('takePhoto')}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void check(f);
        }}
      />

      <div aria-live="polite">
        {busy && (
          <>
            <p className="font-semibold">{t('photoChecking')}</p>
            <Skeleton lines={1} />
          </>
        )}
        {error ? <ErrorState error={error} /> : null}
        {result?.retakeRequired && (
          <StatusCard tone="warn" title={t('photoRetake')} body={reason ?? undefined} />
        )}
        {result && !result.retakeRequired && result.needsHuman && (
          <StatusCard tone="info" title={t('photoOfficer')} body={reason ?? undefined} />
        )}
        {result && !result.retakeRequired && !result.needsHuman && (
          <StatusCard tone="ok" title={t('photoOk')} body={reason ?? undefined} />
        )}
      </div>

      {!result || result.retakeRequired ? (
        <button
          type="button"
          disabled={busy}
          onClick={take}
          className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-2xl bg-brand px-5 text-xl font-bold text-white disabled:bg-slate-400"
        >
          <IconCamera className="h-12 w-12" />
          {result?.retakeRequired ? t('retakePhoto') : t('takePhoto')}
        </button>
      ) : (
        <Button className="w-full" onClick={() => onDone(result)}>
          {t('next')}
        </Button>
      )}
      {(!result || result.retakeRequired || !!error) && (
        <Button variant="ghost" className="w-full" disabled={busy} onClick={() => onDone(result)}>
          {t('skipPhoto')}
        </Button>
      )}
    </div>
  );
}
