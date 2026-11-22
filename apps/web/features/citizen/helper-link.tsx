'use client';

import { useState } from 'react';
import { AudioButton, Button, StatusCard } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/hooks';
import { useI18n, type MessageKey } from '@/lib/i18n';

const weak = (pin: string) => {
  const d = [...pin].map(Number);
  if (d.every((x) => x === d[0])) return true;
  const step = d[1]! - d[0]!;
  return Math.abs(step) === 1 && d.every((x, i) => i === 0 || x - d[i - 1]! === step);
};

/**
 * A family with no smartphone of its own still decides who may act for it: she names a registered
 * helper by his mobile number and chooses the PIN he must ask her for every time.
 */
export function HelperLinkCard() {
  const { t, speak } = useI18n();
  const session = useSession();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; key: MessageKey } | null>(null);
  if (session?.role !== 'citizen') return null;

  const ready = /^03\d{9}$/.test(phone) && /^\d{4}$/.test(pin) && !weak(pin);
  async function save() {
    setBusy(true);
    setNote(null);
    try {
      await api.linkHelper(phone, pin);
      setNote({ tone: 'ok', key: 'helperLinkDone' });
      speak(t('helperLinkDone'));
      setPin('');
    } catch (e) {
      const key =
        e instanceof ApiError && e.status === 404 ? 'helperLinkNotFound' : 'signupPinWeak';
      setNote({
        tone: 'bad',
        key: e instanceof ApiError && e.status === 400 ? 'signupPinWeak' : key,
      });
    } finally {
      setBusy(false);
    }
  }

  const box =
    'mt-1 min-h-14 w-full rounded-xl border-2 border-slate-400 bg-white p-3 text-xl latin';
  return (
    <section className="space-y-3 rounded-2xl border-2 border-slate-300 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h2 className="text-xl font-bold">{t('helperLinkTitle')}</h2>
          <p className="mt-1 text-lg">{t('helperLinkHint')}</p>
        </div>
        <AudioButton text={[t('helperLinkTitle'), t('helperLinkHint')]} className="text-brand" />
      </div>
      <label className="block text-lg font-semibold">
        {t('helperLinkPhone')}
        <input
          className={box}
          dir="ltr"
          inputMode="numeric"
          placeholder="03XXXXXXXXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
        />
      </label>
      <label className="block text-lg font-semibold">
        {t('helperLinkPin')}
        <input
          className={box}
          dir="ltr"
          inputMode="numeric"
          type="password"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
        />
      </label>
      {pin.length === 4 && weak(pin) && (
        <p className="text-lg font-semibold text-red-700">{t('signupPinWeak')}</p>
      )}
      {note && <StatusCard tone={note.tone} title={t(note.key)} />}
      <Button className="w-full" disabled={busy || !ready} onClick={save}>
        {busy ? t('loading') : t('helperLinkSave')}
      </Button>
    </section>
  );
}
