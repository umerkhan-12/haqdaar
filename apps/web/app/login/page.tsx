'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import {
  AudioButton,
  Button,
  ErrorState,
  errorWords,
  Field,
  inputCls,
  PinPad,
  StatusCard,
} from '@/components/ui';
import { typedMobile } from '@/features/citizen/claim-words';
import { api, ApiError } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { HOME, saveHelperSession, rememberPhone, saveSession, sessionFrom } from '@/lib/session';

const DEMO: { role: MessageKey; phone: string }[] = [
  { role: 'demoCitizen', phone: '03001110001' },
  { role: 'demoHelper', phone: '03001110002' },
  { role: 'demoOfficerSana', phone: '03001110003' },
  { role: 'demoOfficerKamran', phone: '03001110006' },
  { role: 'demoAdmin', phone: '03001110004' },
  { role: 'demoAuditor', phone: '03001110005' },
];

/** Citizens sign in with their 4-digit PIN on a keypad; staff (and the demo accounts) use a password. */
export default function LoginPage() {
  const { t, toggle, speak, lang } = useI18n();
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [withPassword, setWithPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    speak(t('loginSay'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  async function signIn(secret: string) {
    setBusy(true);
    setError(null);
    try {
      const s = sessionFrom(await api.login(phone, secret));
      saveHelperSession(null);
      saveSession(s);
      rememberPhone(phone);
      router.replace(HOME[s.role]);
    } catch (err) {
      setError(err);
      setPassword('');
      speak(problemWords(err).map(t));
    } finally {
      setBusy(false);
    }
  }

  function problemWords(err: unknown): MessageKey[] {
    const status = err instanceof ApiError ? err.status : 0;
    if (status === 401) return [withPassword ? 'wrongLogin' : 'wrongLoginPin'];
    if (status === 403) return ['loginLocked'];
    return errorWords(err).filter((k): k is MessageKey => !!k);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void signIn(password);
  }

  function onPin(v: string) {
    setPassword(v);
    if (v.length === 4 && /^03\d{9}$/.test(phone)) void signIn(v);
  }

  const status = error instanceof ApiError ? error.status : 0;

  return (
    <div className="mx-auto max-w-md px-4 py-6">
      <p className="mb-4 rounded-lg bg-amber-100 px-3 py-1 text-center text-xs font-semibold text-amber-900">
        {t('prototype')}
      </p>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-4xl font-bold text-brand">{t('appName')}</h1>
        <button onClick={toggle} className="min-h-12 rounded-lg px-3 text-sm text-brand underline">
          {t('switchLang')}
        </button>
      </div>

      <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <h2 className="flex-1 text-xl font-semibold">{t('loginTitle')}</h2>
          <AudioButton text={t('loginSay')} className="text-brand" />
        </div>
        <p className="text-lg">{t('loginSay')}</p>
        <Field label={t('phone')}>
          <input
            className={inputCls}
            dir="ltr"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(typedMobile(e.target.value))}
            placeholder="03XXXXXXXXX"
            required
          />
        </Field>
        {withPassword ? (
          <Field label={t('password')}>
            <input
              className={inputCls}
              dir="ltr"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
        ) : (
          <PinPad value={password} onChange={onPin} label={t('signupPinLabel')} />
        )}
        {status === 401 ? (
          <StatusCard tone="bad" title={t(withPassword ? 'wrongLogin' : 'wrongLoginPin')} urgent />
        ) : status === 403 ? (
          <StatusCard tone="bad" title={t('loginLocked')} urgent />
        ) : error ? (
          <ErrorState error={error} />
        ) : null}
        <Button
          type="submit"
          disabled={busy || !/^03\d{9}$/.test(phone) || (!withPassword && password.length < 4)}
          className="w-full"
        >
          {busy ? t('loading') : t('signIn')}
        </Button>
        <button
          type="button"
          onClick={() => {
            setWithPassword((w) => !w);
            setPassword('');
            setError(null);
          }}
          className="flex min-h-12 w-full items-center justify-center text-base text-brand underline"
        >
          {t(withPassword ? 'loginUsePin' : 'loginUsePassword')}
        </button>
      </form>

      <Link
        replace
        href="/signup"
        className="mt-4 flex min-h-16 w-full items-center justify-center rounded-xl border-2 border-brand bg-white px-5 text-xl font-semibold text-brand-dark hover:bg-brand-soft"
      >
        {t('signupTitle')}
      </Link>
      <Link
        replace
        href="/forgot-pin"
        className="mt-2 flex min-h-12 w-full items-center justify-center text-lg text-brand underline"
      >
        {t('resetTitle')}
      </Link>

      <section className="mt-6 rounded-2xl border border-dashed border-slate-300 p-4">
        <h2 className="mb-2 text-sm font-semibold text-muted">
          {t('demoAccounts')} · {t('password')}{' '}
          <span className="latin" dir="ltr">
            demo1234
          </span>
        </h2>
        <div className="grid gap-2">
          {DEMO.map((d) => (
            <button
              key={d.phone}
              type="button"
              onClick={() => {
                setPhone(d.phone);
                setPassword('demo1234');
                setWithPassword(true);
                setError(null);
              }}
              className="flex min-h-12 items-center justify-between rounded-lg bg-white px-3 text-start shadow-sm hover:bg-brand-soft"
            >
              <span>{t(d.role)}</span>
              <span className="latin text-sm text-muted" dir="ltr">
                {d.phone}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
