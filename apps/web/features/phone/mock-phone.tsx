'use client';

import { useState } from 'react';
import { Shell } from '@/components/shell';
import { Button, Skeleton, VerdictCard, staffError } from '@/components/ui';
import { api, type ScamVerdict } from '@/lib/api';
import { useAsync } from '@/lib/hooks';

const PHONES = [
  { phone: '03001110001', who: 'Zainab' },
  { phone: '03001110007', who: 'Rashida' },
  { phone: '03451234504', who: 'Nasreen' },
];

/** A phone on the projector: the SMS a family receives, and the one-tap "is this real?" check. */
export function MockPhone() {
  const [phone, setPhone] = useState(PHONES[0]!.phone);
  const { data, error, loading, reload } = useAsync(() => api.inbox(phone), [phone]);
  const [verdicts, setVerdicts] = useState<Record<string, ScamVerdict | string>>({});

  async function check(id: string, text: string) {
    try {
      const v = await api.scamCheck(text);
      setVerdicts((x) => ({ ...x, [id]: v }));
    } catch (e) {
      setVerdicts((x) => ({ ...x, [id]: staffError(e) }));
    }
  }

  return (
    <Shell roles={['admin']} wide>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">Mock phone</h1>
        {PHONES.map((p) => (
          <Button
            key={p.phone}
            variant={p.phone === phone ? 'primary' : 'ghost'}
            onClick={() => setPhone(p.phone)}
            className="text-sm"
          >
            {p.who}
          </Button>
        ))}
        <Button variant="ghost" onClick={reload} className="text-sm">
          Refresh
        </Button>
      </div>
      <div className="mx-auto w-full max-w-sm rounded-[2.5rem] border-[10px] border-slate-800 bg-slate-100 p-3 shadow-xl">
        <p className="mb-2 text-center font-mono text-xs text-muted">{phone} · Messages</p>
        <div className="max-h-[32rem] space-y-3 overflow-y-auto" aria-live="polite">
          {loading && !data ? (
            <Skeleton lines={3} />
          ) : error ? (
            <p role="alert">{staffError(error)}</p>
          ) : !data?.length ? (
            <p className="p-6 text-center text-muted">
              No messages yet. Run a payout in Judge Mode.
            </p>
          ) : (
            data.map((m) => {
              const v = verdicts[m.messageId];
              return (
                <div key={m.messageId} className="space-y-2">
                  <div className="rounded-2xl rounded-tl-sm bg-white p-3 shadow-sm">
                    <p className="text-xs text-muted">
                      {m.from} · {new Date(m.receivedAt).toLocaleTimeString('en-PK')}
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm">{m.body}</p>
                    <button
                      className="mt-2 min-h-12 text-sm font-semibold text-brand underline"
                      onClick={() => check(m.messageId, m.body)}
                    >
                      Is this real?
                    </button>
                  </div>
                  {typeof v === 'string' ? (
                    <p role="alert">{v}</p>
                  ) : v ? (
                    <VerdictCard v={v} />
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </Shell>
  );
}
