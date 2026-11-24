'use client';

import { leaveTo } from '@/components/history-guard';
import { useState } from 'react';
import { Shell } from '@/components/shell';
import { IconLock, IconUsers } from '@/components/icons';
import {
  AudioButton,
  Button,
  EmptyState,
  ErrorState,
  errorWords,
  PinPad,
  Skeleton,
  StatusCard,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAsync } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import {
  forgetPerson,
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

/**
 * The helper's own session, fresh. A family session left open is closed first; then one ordinary call
 * renews his access token if it has expired, so a right PIN is never refused as "wrong" after 15 minutes.
 */
async function freshHelper() {
  const current = getSession();
  const stored = getHelperSession();
  if (current?.personId && stored) {
    forgetPerson(current.personId);
    saveSession(stored);
    saveHelperSession(null);
  }
  const families = await api.families();
  return { helper: getSession(), families };
}

/** Helper Mode: a shopkeeper serves many families; each needs its own PIN, one at a time. */
export function HelperFamilies() {
  const { t, speak } = useI18n();
  const { data, error, loading, reload } = useAsync(() => api.families(), []);
  const [chosen, setChosen] = useState<Family | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<unknown>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);

  function showLocked() {
    setLocked(true);
    speak(t('pinLocked'));
    reload();
  }

  async function unlock(f: Family, value: string) {
    setBusy(true);
    setPinError(null);
    try {
      const { helper, families } = await freshHelper();
      if (!helper) return;
      if (families.find((x) => x.personId === f.personId)?.locked) return showLocked();
      // Keep the helper's own session (not a family's) so switching never chains family sessions.
      const tokens = await api.actFor(f.personId, value, helper.accessToken);
      saveHelperSession(helper);
      saveSession(sessionFrom(tokens, f.label));
      leaveTo('/citizen');
    } catch (e) {
      setPin('');
      // His own session ended (signed out elsewhere): the frame sends him to the login screen.
      if (!getSession()) return;
      if (e instanceof ApiError && e.status === 403) return showLocked();
      setPinError(e);
      if (e instanceof ApiError && e.status === 401) {
        speak([t('wrongPin'), t('enterPin')]);
        // The fifth wrong PIN locks the family: the list shows it straight away.
        reload();
      } else {
        const [title, help] = errorWords(e);
        speak(help ? [t(title), t(help)] : t(title));
      }
    } finally {
      setBusy(false);
    }
  }

  const onPin = (v: string) => {
    setPin(v);
    if (chosen && v.length === 4) void unlock(chosen, v);
  };

  const wrongPin = pinError instanceof ApiError && pinError.status === 401;
  const nowLocked = locked || !!data?.find((x) => x.personId === chosen?.personId)?.locked;

  return (
    <Shell roles={['helper']}>
      {!chosen ? (
        <>
          <div className="mb-4 flex items-center gap-3">
            <IconUsers className="h-8 w-8 text-brand" />
            <h1 className="flex-1 text-2xl font-bold">{t('helperTitle')}</h1>
            <AudioButton text={t('helperTitle')} className="text-brand" />
          </div>
          <p className="mb-3 rounded-xl border border-dashed border-slate-300 p-3 text-sm text-muted">
            {t('helperDemoPins')}
          </p>
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
                      setLocked(false);
                      speak([f.label, t('enterPin')]);
                    }}
                    className="flex min-h-16 w-full items-center gap-4 rounded-2xl border-2 border-slate-300 bg-white p-4 text-start text-lg font-semibold disabled:opacity-60"
                  >
                    <IconLock className="h-6 w-6 shrink-0 text-brand" />
                    <span className="flex-1">
                      {f.label}
                      {f.locked && (
                        <span className="block text-base font-normal text-red-800">
                          {t('familyLocked')}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="space-y-5">
          <h1 className="text-2xl font-bold">{chosen.label}</h1>
          <div className="flex items-center gap-3">
            <p className="flex-1 text-lg">{t('enterPin')}</p>
            <AudioButton text={[chosen.label, t('enterPin')]} className="text-brand" />
          </div>
          {nowLocked ? (
            <StatusCard tone="bad" title={t('pinLocked')} urgent />
          ) : wrongPin ? (
            <StatusCard tone="bad" title={t('wrongPin')} urgent />
          ) : pinError ? (
            <ErrorState error={pinError} />
          ) : null}
          {busy ? (
            <Skeleton lines={1} />
          ) : nowLocked ? null : (
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
