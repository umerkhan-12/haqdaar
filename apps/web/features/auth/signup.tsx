'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { AudioButton, Button, ErrorState, inputCls, PinPad, StatusCard } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { HOME, saveHelperSession, rememberPhone, saveSession, sessionFrom } from '@/lib/session';

/** One thing per screen. Each screen has one spoken instruction (the main channel) and one action. */
type Screen = 'phone' | 'code' | 'name' | 'pin' | 'pinAgain';

const SAY: Record<Screen, MessageKey> = {
  phone: 'signupPhoneSay',
  code: 'signupCodeSay',
  name: 'signupNameSay',
  pin: 'signupPinSay',
  pinAgain: 'signupPinAgainSay',
};
/** The three steps shown as dots: phone → code and name → PIN. */
const STEP: Record<Screen, number> = { phone: 0, code: 1, name: 1, pin: 2, pinAgain: 2 };

/** Citizen self sign-up: phone → SMS code + name → 4-digit PIN (twice) → logged in. */
export function Signup() {
  const { t, toggle, speak, lang } = useI18n();
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sms, setSms] = useState<string | null>(null);

  // Speak the instruction once whenever a screen appears (and again if the language changes).
  useEffect(() => {
    speak(problem ? `${t(problem)} ${t(SAY[screen])}` : t(SAY[screen]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, lang]);

  // PROTOTYPE: there is no real SMS, so show the simulated message here while the code is awaited.
  useEffect(() => {
    if (screen !== 'code') return;
    let live = true;
    const load = () =>
      api
        .signupSms(phone)
        .then((r) => live && setSms(r.message?.body ?? null))
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [screen, phone]);

  const go = (s: Screen) => {
    setProblem(null);
    setError(null);
    setScreen(s);
  };
  const fail = (k: MessageKey) => {
    setProblem(k);
    speak(t(k));
  };

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    if (!/^03\d{9}$/.test(phone)) return fail('signupPhoneBad');
    setBusy(true);
    setProblem(null);
    setError(null);
    try {
      await api.signupStart(phone);
      setCode('');
      setSms(null);
      if (screen === 'code') speak(t('signupCodeSay'));
      else go('code');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  /** A wrong code is refused here, before the name and PIN are asked. */
  async function checkCodeNow() {
    setBusy(true);
    setProblem(null);
    setError(null);
    try {
      await api.signupCheck({ phone, code });
      go('name');
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setCode('');
      if (status === 400 || status === 403)
        fail(status === 403 ? 'signupTooMany' : 'signupWrongCode');
      else setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setProblem(null);
    setError(null);
    try {
      const s = sessionFrom(
        await api.signupVerify({ phone, code, fullName: fullName.trim(), pin }),
      );
      saveHelperSession(null);
      saveSession(s);
      rememberPhone(phone);
      router.replace(HOME[s.role]);
    } catch (err) {
      setPin('');
      setPin2('');
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 400 || status === 403) {
        setCode('');
        setScreen('code');
        fail(status === 403 ? 'signupTooMany' : 'signupWrongCode');
      } else if (status === 409) {
        setScreen('phone');
        fail('signupExists');
      } else {
        setScreen('pin');
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  }

  function pinAgain(v: string) {
    setPin2(v);
    if (v.length < 4) return;
    if (v === pin) return;
    setPin('');
    setPin2('');
    setScreen('pin');
    fail('signupPinMismatch');
  }

  return (
    <div className="mx-auto max-w-md px-4 py-6">
      <p className="mb-4 rounded-lg bg-amber-100 px-3 py-1 text-center text-xs font-semibold text-amber-900">
        {t('prototype')}
      </p>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-3xl font-bold text-brand">{t('signupTitle')}</h1>
        <button onClick={toggle} className="min-h-12 rounded-lg px-3 text-sm text-brand underline">
          {t('switchLang')}
        </button>
      </div>

      <div
        className="mb-4 flex justify-center gap-2"
        dir="ltr"
        aria-label={`${STEP[screen] + 1} / 3`}
        role="img"
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-2 w-12 rounded-full ${i <= STEP[screen] ? 'bg-brand' : 'bg-slate-300'}`}
          />
        ))}
      </div>

      <section className="space-y-5 rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3 text-brand-dark">
          <AudioButton text={t(SAY[screen])} />
          <h2 className="flex-1 text-xl font-semibold text-ink">{t(SAY[screen])}</h2>
        </div>

        {problem && <StatusCard tone="bad" title={t(problem)} urgent />}
        {error ? <ErrorState error={error} /> : null}

        {screen === 'phone' && (
          <form onSubmit={sendCode} className="space-y-5">
            <input
              className={`${inputCls} min-h-16 text-center text-2xl tracking-widest`}
              dir="ltr"
              inputMode="numeric"
              autoComplete="tel"
              aria-label={t('phone')}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
              placeholder="03XXXXXXXXX"
              autoFocus
            />
            <Button type="submit" disabled={busy} className="min-h-16 w-full">
              {busy ? t('loading') : t('signupSendCode')}
            </Button>
          </form>
        )}

        {screen === 'code' && (
          <div className="space-y-5">
            <div
              className="rounded-2xl border-2 border-dashed border-amber-500 bg-amber-50 p-3"
              role="status"
            >
              <p className="text-xs font-bold text-amber-900">{t('signupSmsSimulated')}</p>
              <p className="mt-1 whitespace-pre-line text-base" dir="auto">
                {sms ?? t('signupSmsWaiting')}
              </p>
            </div>
            <PinPad length={6} value={code} onChange={setCode} label={t('signupCodeLabel')} />
            <Button
              disabled={code.length < 6 || busy}
              onClick={checkCodeNow}
              className="min-h-16 w-full"
            >
              {t('next')}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => sendCode()} className="w-full">
              {busy ? t('loading') : t('signupResend')}
            </Button>
            <p className="latin text-center text-xs text-muted" dir="ltr">
              Prototype: no real SMS is sent. The code appears above and on the{' '}
              <Link replace href="/phone" className="underline">
                Mock phone screen
              </Link>{' '}
              (admin login).
            </p>
          </div>
        )}

        {screen === 'name' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (fullName.trim().length >= 2) go('pin');
            }}
            className="space-y-5"
          >
            <input
              className={`${inputCls} min-h-16 text-2xl`}
              dir="auto"
              autoComplete="name"
              aria-label={t('fullName')}
              value={fullName}
              onChange={(e) => setFullName(e.target.value.slice(0, 80))}
              autoFocus
            />
            <Button type="submit" disabled={fullName.trim().length < 2} className="min-h-16 w-full">
              {t('next')}
            </Button>
          </form>
        )}

        {screen === 'pin' && (
          <PinPad
            value={pin}
            onChange={(v) => {
              setPin(v);
              if (v.length === 4) go('pinAgain');
            }}
            label={t('signupPinLabel')}
          />
        )}

        {screen === 'pinAgain' && (
          <div className="space-y-5">
            <PinPad value={pin2} onChange={pinAgain} label={t('signupPinLabel')} />
            <Button disabled={busy || pin2 !== pin} onClick={create} className="min-h-16 w-full">
              {busy ? t('loading') : t('signupCreate')}
            </Button>
          </div>
        )}
      </section>

      <div className="mt-5 flex flex-col gap-3">
        {screen !== 'phone' && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setPin('');
              setPin2('');
              go(({ code: 'phone', name: 'code', pin: 'name', pinAgain: 'pin' } as const)[screen]);
            }}
          >
            {t('back')}
          </Button>
        )}
        <Link
          replace
          href="/login"
          className="flex min-h-12 items-center justify-center text-lg text-brand underline"
        >
          {t('signupHaveAccount')}
        </Link>
      </div>
    </div>
  );
}
