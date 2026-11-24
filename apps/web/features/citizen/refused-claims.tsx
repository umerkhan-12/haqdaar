'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, errorReason, StatusCard } from '@/components/ui';
import { useSession } from '@/lib/hooks';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { discard, refused, type OutboxItem } from '@/lib/outbox';
import { draftKey } from '@/lib/session';
import { EMPTY, type Details } from './claim-words';

const words = (item: OutboxItem): [MessageKey, MessageKey?] =>
  errorReason(item.failed?.code) ?? [item.failed?.status === 403 ? 'forbidden' : 'error'];

/**
 * A claim saved offline that the server then refused (for example, the CNIC is already registered).
 * It is never dropped silently: she hears why, and one tap opens it again with her answers filled in.
 */
export function RefusedClaims() {
  const { t, speak, lang } = useI18n();
  const router = useRouter();
  const personId = useSession()?.personId ?? null;
  const [items, setItems] = useState<OutboxItem[]>([]);

  useEffect(() => {
    const load = () => void refused(personId).then(setItems);
    load();
    window.addEventListener('hq:outbox', load);
    return () => window.removeEventListener('hq:outbox', load);
  }, [personId]);

  const first = items[0];
  useEffect(() => {
    if (!first) return;
    const [title, help] = words(first);
    speak([t('outboxRefused'), t(title), ...(help ? [t(help)] : [])]);
    // Said once when the refusal appears, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first?.key, lang]);

  async function fix(item: OutboxItem) {
    const c = item.claim;
    const details: Details = {
      ...EMPTY,
      fullName: c.fullName,
      cnic: c.cnic,
      district: c.district ?? '',
      householdSize: c.householdSize ? String(c.householdSize) : '',
      alias: c.payout.alias ?? '',
    };
    localStorage.setItem(
      draftKey(item.personId),
      JSON.stringify({ details, step: 'edit', cardSeen: true, savedAt: Date.now() }),
    );
    await discard(item.key);
    router.replace('/citizen/claim');
  }

  if (!first) return null;
  const [title, help] = words(first);
  return (
    <div className="mb-5 space-y-3">
      <StatusCard
        tone="bad"
        title={`${t('outboxRefused')} ${t(title)}`}
        body={help ? t(help) : undefined}
        urgent
      />
      <Button className="w-full" onClick={() => void fix(first)}>
        {t('changeDetails')}
      </Button>
    </div>
  );
}
