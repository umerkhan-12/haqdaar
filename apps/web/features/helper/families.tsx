'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Shell } from '@/components/shell';
import { IconLock, IconUsers } from '@/components/icons';
import {
  AudioButton,
  Button,
  EmptyState,
  ErrorState,
  PinPad,
  Skeleton,
  StatusCard,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAsync } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import {
  getHelperSession,
  getSession,
  saveHelperSession,
  saveSession,
  sessionFrom,
} from '@/lib/session';

interface Family {
  personId: string;
  label: string;
  locked: boolean;
}

/** Helper Mode: a shopkeeper serves many families; each needs its own PIN, one at a time. */
export function HelperFamilies() {
  const { t } = useI18n();
  const router = useRouter();
  const { data, error, loading, reload } = useAsync(() => api.families(), []);
  const [chosen, setChosen] = useState<Family | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function unlock(f: Family, value: string) {
    // Keep the helper's own session (not a family's) so switching never chains family sessions.
    const helper = getHelperSession() ?? getSession();
    if (!helper) return;
    setBusy(true);
    setPinError(null);
    try {
      const tokens = await api.actFor(f.personId, value, helper.accessToken);
      saveHelperSession(helper);
      saveSession(sessionFrom(tokens, f.label));
      router.replace('/citizen');
    } catch (e) {
      setPinError(e);
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  const onPin = (v: string) => {
    setPin(v);
    if (chosen && v.length === 4) void unlock(chosen, v);
  };

  const wrongPin = pinError instanceof ApiError && pinError.status === 401;

  return (
    <Shell roles={['helper']}>
      {!chosen ? (
        <>
          <div className="mb-4 flex items-center gap-3">
            <IconUsers className="h-8 w-8 text-brand" />
            <h1 className="flex-1 text-2xl font-bold">{t('helperTitle')}</h1>
            <AudioButton text={t('helperTitle')} className="text-brand" />
          </div>
          {loading && !data ? (
            <Skeleton lines={4} />
          ) : error ? (
            <ErrorState error={error} onRetry={reload} />
          ) : !data?.length ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="space-y-3">
              {data.map((f) => (
                <li key={f.personId}>
                  <button
                    type="button"
                    disabled={f.locked}
                    onClick={() => {
                      setChosen(f);
                      setPin('');
                      setPinError(null);
                    }}
                    className="flex min-h-16 w-full items-center gap-4 rounded-2xl border-2 border-slate-300 bg-white p-4 text-start text-lg font-semibold disabled:opacity-60"
                  >
                    <IconLock className="h-6 w-6 shrink-0 text-brand" />
                    <span className="flex-1">{f.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="space-y-5">
          <h1 className="text-2xl font-bold">{chosen.label}</h1>
          <p className="text-lg">{t('enterPin')}</p>
          {wrongPin ? (
            <StatusCard tone="bad" title={t('wrongPin')} urgent />
          ) : pinError ? (
            <ErrorState error={pinError} />
          ) : null}
          {busy ? (
            <Skeleton lines={1} />
          ) : (
            <PinPad value={pin} onChange={onPin} label={t('enterPin')} />
          )}
          <Button variant="ghost" className="w-full" onClick={() => setChosen(null)}>
            {t('back')}
          </Button>
        </div>
      )}
    </Shell>
  );
}
