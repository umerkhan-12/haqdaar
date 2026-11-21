import { openDB, type IDBPDatabase } from 'idb';
import { api, ApiError, type ClaimInput } from './api';

/**
 * Offline outbox: a claim made without signal is stored on the phone with its idempotency key
 * and sent when the network returns. Resending is safe: the same key always means the same case.
 */
export interface OutboxItem {
  key: string;
  claim: ClaimInput;
  personId: string;
  /** Consents the citizen gave on the phone; granted before the claim is sent. */
  consents: string[];
  createdAt: number;
  attempts: number;
}

let db: Promise<IDBPDatabase> | null = null;
const store = () =>
  (db ??= openDB('haqdaar', 1, {
    upgrade(d) {
      d.createObjectStore('outbox', { keyPath: 'key' });
    },
  }));

export async function enqueue(item: Omit<OutboxItem, 'createdAt' | 'attempts'>): Promise<void> {
  await (await store()).put('outbox', { ...item, createdAt: Date.now(), attempts: 0 });
  notify();
}

export async function pending(): Promise<OutboxItem[]> {
  return (await store()).getAll('outbox');
}

let flushing = false;

/** Send everything waiting. Network errors keep the item; a definite server answer removes it. */
export async function flush(): Promise<number> {
  if (flushing || (typeof navigator !== 'undefined' && !navigator.onLine)) return 0;
  flushing = true;
  let sent = 0;
  try {
    const d = await store();
    for (const item of await d.getAll('outbox')) {
      try {
        for (const purpose of item.consents) await api.grantConsent(item.personId, purpose);
        await api.submitClaim(item.claim, item.key);
        await d.delete('outbox', item.key);
        sent++;
      } catch (e) {
        if (!(e instanceof ApiError) || e.offline || e.status === 401) break;
        const definiteNo = e.status >= 400 && e.status < 500 && e.status !== 429;
        if (definiteNo) await d.delete('outbox', item.key);
        else await d.put('outbox', { ...item, attempts: item.attempts + 1 });
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
