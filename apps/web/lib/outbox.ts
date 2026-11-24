import { openDB, type IDBPDatabase } from 'idb';
import { api, ApiError, type ClaimInput } from './api';

/**
 * Offline outbox: a claim made without signal is stored on the phone with its idempotency key
 * and sent when the network returns. Resending is safe: the same key always means the same case.
 * Items belong to one person: they are counted, shown and sent only while that person's session is open,
 * so on a shared phone (or a helper switching families) nobody else's claim is sent with the wrong account.
 */
export interface OutboxItem {
  key: string;
  claim: ClaimInput;
  personId: string;
  /** Consents the citizen gave on the phone; granted before the claim is sent. */
  consents: string[];
  createdAt: number;
  attempts: number;
  /** The server refused it for good: kept (not resent) so she hears why and can correct it. */
  failed?: { status: number; code?: string };
}

let db: Promise<IDBPDatabase> | null = null;
const store = () =>
  (db ??= openDB('haqdaar', 1, {
    upgrade(d) {
      d.createObjectStore('outbox', { keyPath: 'key' });
    },
  }));

const mine = async (personId: string | null): Promise<OutboxItem[]> =>
  personId
    ? ((await (await store()).getAll('outbox')) as OutboxItem[]).filter(
        (i) => i.personId === personId,
      )
    : [];

export async function enqueue(item: Omit<OutboxItem, 'createdAt' | 'attempts'>): Promise<void> {
  await (await store()).put('outbox', { ...item, createdAt: Date.now(), attempts: 0 });
  notify();
}

/** This person's claims still waiting to be sent. */
export async function pending(personId: string | null): Promise<OutboxItem[]> {
  return (await mine(personId)).filter((i) => !i.failed);
}

/** This person's claims the server refused, with the reason. */
export async function refused(personId: string | null): Promise<OutboxItem[]> {
  return (await mine(personId)).filter((i) => i.failed);
}

export async function discard(key: string): Promise<void> {
  await (await store()).delete('outbox', key);
  notify();
}

let flushing = false;

/**
 * Send this person's waiting claims. Network errors keep the item; a definite refusal keeps it marked
 * failed with the server's code; only a success removes it.
 */
export async function flush(personId: string | null): Promise<number> {
  if (!personId || flushing || (typeof navigator !== 'undefined' && !navigator.onLine)) return 0;
  flushing = true;
  let sent = 0;
  try {
    const d = await store();
    for (const item of await pending(personId)) {
      try {
        for (const purpose of item.consents) await api.grantConsent(item.personId, purpose);
        await api.submitClaim(item.claim, item.key);
        await d.delete('outbox', item.key);
        sent++;
      } catch (e) {
        if (!(e instanceof ApiError) || e.offline || e.status === 401) break;
        const definiteNo = e.status >= 400 && e.status < 500 && e.status !== 429;
        await d.put('outbox', {
          ...item,
          attempts: item.attempts + 1,
          ...(definiteNo ? { failed: { status: e.status, code: e.code } } : {}),
        });
      }
    }
  } finally {
    flushing = false;
    notify();
  }
  return sent;
}

function notify() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('hq:outbox'));
}
