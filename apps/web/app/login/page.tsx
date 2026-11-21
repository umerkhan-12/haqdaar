'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, ErrorState, Field, inputCls, StatusCard } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { HOME, saveHelperSession, saveSession, sessionFrom } from '@/lib/session';

const DEMO = [
  { role: 'Citizen — Zainab', phone: '03001110001' },
  { role: 'Helper — shopkeeper Asif', phone: '03001110002' },
  { role: 'Officer — Sana', phone: '03001110003' },
  { role: 'Officer — Kamran', phone: '03001110006' },
  { role: 'Admin — Hira (Judge Mode)', phone: '03001110004' },
  { role: 'Auditor — Bilal', phone: '03001110005' },
];

export default function LoginPage() {
  const { t, toggle } = useI18n();
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = sessionFrom(await api.login(phone, password));
      saveHelperSession(null);
      saveSession(s);
      router.replace(HOME[s.role]);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const wrong = error instanceof ApiError && error.status === 401;

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
        <h2 className="text-xl font-semibold">{t('loginTitle')}</h2>
        <Field label={t('phone')}>
          <input
            className={inputCls}
            dir="ltr"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="03XXXXXXXXX"
            required
          />
        </Field>
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
        {wrong ? (
          <StatusCard tone="bad" title={t('wrongLogin')} />
        ) : error ? (
          <ErrorState error={error} />
        ) : null}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? t('loading') : t('signIn')}
        </Button>
      </form>

      <section
        className="latin mt-6 rounded-2xl border border-dashed border-slate-300 p-4"
        dir="ltr"
      >
        <h2 className="mb-2 text-sm font-semibold text-muted">
          {t('demoAccounts')} · password demo1234
        </h2>
        <div className="grid gap-2">
          {DEMO.map((d) => (
            <button
              key={d.phone}
              type="button"
              onClick={() => {
                setPhone(d.phone);
                setPassword('demo1234');
              }}
              className="flex min-h-12 items-center justify-between rounded-lg bg-white px-3 text-start shadow-sm hover:bg-brand-soft"
            >
              <span>{d.role}</span>
              <span className="text-sm text-muted">{d.phone}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
