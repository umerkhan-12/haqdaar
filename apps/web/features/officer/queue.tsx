'use client';

import { useMemo, useState } from 'react';
import { Shell } from '@/components/shell';
import { Skeleton, StatusPill, laneTone, staffError } from '@/components/ui';
import { api, type QueueCase } from '@/lib/api';
import { useAsync, useSession } from '@/lib/hooks';
import { CasePanel } from './case-panel';
import { FraudScan } from './fraud-signals';
import { flagLabel, laneLabel, staffName } from './labels';

type Sort = 'priority' | 'confidence' | 'waiting';

/** Each order answers one question an officer asks: what is riskiest, what is least certain, who waited longest. */
const SORTS: Record<Sort, { label: string; compare: (a: QueueCase, b: QueueCase) => number }> = {
  priority: { label: 'Priority', compare: (a, b) => (b.priority ?? 0) - (a.priority ?? 0) },
  confidence: {
    label: 'Lowest confidence',
    compare: (a, b) => (a.confidence ?? 0) - (b.confidence ?? 0),
  },
  waiting: {
    label: 'Longest waiting',
    compare: (a, b) => (b.waitingMinutes ?? 0) - (a.waitingMinutes ?? 0),
  },
};

function waited(minutes = 0): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} days`;
}

/** Officer queue. No names or CNICs here, only what is needed to pick the next case. */
export function OfficerQueue() {
  const { data, error, loading, reload } = useAsync(() => api.staffQueue(), []);
  const me = useSession()?.userId;
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('priority');

  const rows = useMemo(() => [...(data ?? [])].sort(SORTS[sort].compare), [data, sort]);
  const counts = useMemo(() => {
    const lanes = new Map<string, number>();
    for (const c of data ?? [])
      lanes.set(laneLabel(c.lane), (lanes.get(laneLabel(c.lane)) ?? 0) + 1);
    return {
      lanes: [...lanes.entries()],
      escalated: (data ?? []).filter((c) => c.escalated).length,
      mine: (data ?? []).filter((c) => c.assignedTo === me).length,
    };
  }, [data, me]);

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

          <FraudScan onDone={reload} />

          {data && data.length > 0 && (
            <>
              <p className="mb-2 flex flex-wrap gap-1 text-xs" aria-label="Cases per lane">
                {counts.lanes.map(([lane, n]) => (
                  <StatusPill key={lane} tone="info">
                    {lane}: {n}
                  </StatusPill>
                ))}
                <StatusPill tone={counts.escalated ? 'bad' : 'neutral'}>
                  Escalated: {counts.escalated}
                </StatusPill>
                <StatusPill>Assigned to you: {counts.mine}</StatusPill>
              </p>
              <div role="group" aria-label="Sort the queue" className="mb-2 flex gap-1">
                {(Object.keys(SORTS) as Sort[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSort(s)}
                    aria-pressed={sort === s}
                    className={`min-h-12 flex-1 rounded-lg border-2 px-2 text-sm font-medium ${sort === s ? 'border-brand bg-brand-soft text-brand-dark' : 'border-slate-300 bg-white'}`}
                  >
                    {SORTS[s].label}
                  </button>
                ))}
              </div>
            </>
          )}

          {loading && !data ? (
            <Skeleton lines={6} />
          ) : error ? (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">
              {staffError(error)}
            </p>
          ) : !rows.length ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-4 text-muted">
              Queue is empty. Automation handled everything it was sure about.
            </p>
          ) : (
            <ol className="space-y-2">
              {rows.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setOpen(c.id)}
                    aria-current={open === c.id}
                    className={`w-full rounded-xl border-2 p-3 text-left ${open === c.id ? 'border-brand bg-brand-soft' : 'border-slate-200 bg-white'}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted">{c.id.slice(0, 8)}</span>
                      <StatusPill tone={laneTone(c.lane)}>{laneLabel(c.lane)}</StatusPill>
                      {c.escalated && <StatusPill tone="bad">Escalated</StatusPill>}
                      <span className="ml-auto text-xs text-muted">
                        priority {c.priority?.toLocaleString('en-PK')}
                      </span>
                    </div>
                    <div className="mt-1 text-sm">
                      {c.district ?? '—'} · confidence {c.confidence?.toFixed(2) ?? '—'} · waiting{' '}
                      {waited(c.waitingMinutes)}
                    </div>
                    {c.assignedTo && (
                      <div className="mt-1 text-xs text-muted">
                        Assigned to {staffName(c.assignedTo, me)}
                      </div>
                    )}
                    {c.flags.length > 0 && (
                      <div className="mt-1 text-xs text-amber-900">
                        {c.flags.map((f) => flagLabel(f).label).join(' · ')}
                      </div>
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
