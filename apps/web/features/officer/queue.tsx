'use client';

import { useState } from 'react';
import { Shell } from '@/components/shell';
import { Skeleton, StatusPill, laneTone, staffError } from '@/components/ui';
import { api } from '@/lib/api';
import { useAsync } from '@/lib/hooks';
import { CasePanel } from './case-panel';

/** Officer queue: highest priority first (risk × amount × waiting time). No names or CNICs here. */
export function OfficerQueue() {
  const { data, error, loading, reload } = useAsync(() => api.queue(), []);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Shell roles={['officer', 'admin']} wide>
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <section aria-labelledby="queue-h">
          <div className="mb-2 flex items-center justify-between">
            <h1 id="queue-h" className="text-xl font-bold">
              Review queue {data && <span className="text-muted">({data.length})</span>}
            </h1>
            <button
              onClick={reload}
              className="min-h-12 rounded-lg px-3 text-sm text-brand underline"
            >
              Refresh
            </button>
          </div>
          {loading && !data ? (
            <Skeleton lines={6} />
          ) : error ? (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">
              {staffError(error)}
            </p>
          ) : !data?.length ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-4 text-muted">
              Queue is empty. Automation handled everything it was sure about.
            </p>
          ) : (
            <ol className="space-y-2">
              {data.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setOpen(c.id)}
                    aria-current={open === c.id}
                    className={`w-full rounded-xl border-2 p-3 text-left ${open === c.id ? 'border-brand bg-brand-soft' : 'border-slate-200 bg-white'}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted">{c.id.slice(0, 8)}</span>
                      <StatusPill tone={laneTone(c.lane)}>{c.status}</StatusPill>
                      <span className="ml-auto text-xs text-muted">
                        priority {c.priority?.toFixed(2)}
                      </span>
                    </div>
                    <div className="mt-1 text-sm">
                      {c.district ?? '—'} · conf {c.confidence?.toFixed(2) ?? '—'} · waiting{' '}
                      {c.waitingMinutes} min
                    </div>
                    {c.flags.length > 0 && (
                      <div className="mt-1 text-xs text-amber-900">{c.flags.join(', ')}</div>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section aria-label="Case detail">
          {open ? (
            <CasePanel id={open} onDone={reload} />
          ) : (
            <p className="rounded-xl border border-dashed border-slate-300 p-6 text-muted">
              Select a case from the queue.
            </p>
          )}
        </section>
      </div>
    </Shell>
  );
}
