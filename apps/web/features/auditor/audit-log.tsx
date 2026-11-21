'use client';

import { useState, type FormEvent } from 'react';
import { Shell } from '@/components/shell';
import { Button, Card, DataTable, Skeleton, StatusPill, staffError } from '@/components/ui';
import { api, type AuditEntry } from '@/lib/api';
import { useAsync } from '@/lib/hooks';
import {
  QUICK_FILTERS,
  eventLabel,
  eventSummary,
  eventTone,
  maskedJson,
  statBuckets,
  type QuickFilter,
} from './labels';
import { TraceView, type CaseTrace } from './trace-view';

const PAGE = 25;
/** AI calls by the submitter this long before the claim are shown as "involved" in its trace. */
const AI_WINDOW_MS = 30 * 60_000;

const params = (o: Record<string, string>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString();

/** One page of entries. A quick filter covers several exact event types, so it asks once per type and merges by sequence. */
async function loadEntries(q: {
  quick: QuickFilter;
  type: string;
  entityId: string;
  cursor: string;
}) {
  const types = QUICK_FILTERS.find((f) => f.id === q.quick)?.types ?? [];
  if (!types.length)
    return api.audit(
      params({ type: q.type, entityId: q.entityId, cursor: q.cursor, limit: String(PAGE) }),
    );
  const pages = await Promise.all(
    types.map((type) =>
      api.audit(params({ type, entityId: q.entityId, cursor: q.cursor, limit: String(PAGE) })),
    ),
  );
  const merged = pages
    .flatMap((p) => p.items)
    .sort((a, b) => b.seq - a.seq)
    .slice(0, PAGE);
  const more =
    pages.some((p) => p.nextCursor) || pages.reduce((n, p) => n + p.items.length, 0) > PAGE;
  return {
    items: merged,
    nextCursor: more && merged.length ? merged[merged.length - 1].seq : null,
  };
}

const caseOf = (e: AuditEntry) =>
  e.type.startsWith('cases.case.') ? (e.payload as { caseId?: string } | null)?.caseId : undefined;

/** Every decision of a case (automatic and human), plus the AI calls its submitter made just before. */
async function loadTrace(caseId: string): Promise<CaseTrace> {
  const caseView = await api.staffCase(caseId);
  const ids = caseView.timeline
    .map((e) => (e.data as { decisionId?: string } | null)?.decisionId)
    .filter((id): id is string => typeof id === 'string');
  const unique = [...new Set(ids.length ? ids : caseView.decision ? [caseView.decision.id] : [])];
  const traces = await Promise.all(unique.map((id) => api.decisionTrace(id)));
  const submitted = caseView.timeline.find((e) => e.type === 'submitted');
  const created = new Date(caseView.createdAt).getTime();
  const aiCalls = submitted
    ? (
        await api.audit(
          params({
            type: 'ai.call.completed',
            actorId: submitted.actor,
            from: new Date(created - AI_WINDOW_MS).toISOString(),
            to: new Date(created).toISOString(),
            limit: '20',
          }),
        )
      ).items.reverse()
    : [];
  return { caseView, traces, aiCalls };
}

/** Read-only, tamper-evident record. Auditors filter, read a decision trace in plain words, and verify the hash chain. */
export function AuditLog() {
  const [filters, setFilters] = useState({ type: '', entityId: '' });
  const [query, setQuery] = useState({
    quick: 'all' as QuickFilter,
    type: '',
    entityId: '',
    cursor: '',
  });
  const { data, error, loading } = useAsync(() => loadEntries(query), [JSON.stringify(query)]);
  const stats = useAsync(() => api.auditStats(), []);
  const [verify, setVerify] = useState<Awaited<ReturnType<typeof api.verifyChain>> | null>(null);
  const [trace, setTrace] = useState<CaseTrace | null>(null);
  const [entry, setEntry] = useState<AuditEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const apply = (e: FormEvent) => {
    e.preventDefault();
    setQuery({ quick: filters.type ? 'all' : query.quick, ...filters, cursor: '' });
  };

  async function open<T>(load: () => Promise<T>, show: (v: T) => void) {
    setBusy(true);
    setMsg(null);
    try {
      show(await load());
    } catch (err) {
      setMsg(staffError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell roles={['auditor', 'admin']} wide>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-bold">Audit log</h1>
        <Button disabled={busy} onClick={() => open(() => api.verifyChain(), setVerify)}>
          Verify chain
        </Button>
      </div>

      {stats.data && (
        <dl
          className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
          aria-label="Audit log totals"
        >
          {[
            { label: 'Entries in the chain', count: stats.data.total },
            {
              label: 'Last 24 h',
              count: Object.values(stats.data.last24h).reduce((a, b) => a + b, 0),
            },
            ...statBuckets(stats.data.last24h).map((b) => ({
              label: `${b.label} (24 h)`,
              count: b.count,
            })),
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-3">
              <dt className="text-xs text-muted">{s.label}</dt>
              <dd className="text-xl font-bold">{s.count.toLocaleString('en-PK')}</dd>
            </div>
          ))}
        </dl>
      )}
      {stats.data?.lastRecordedAt && (
        <p className="mb-3 text-xs text-muted">
          Latest entry #{stats.data.lastSeq} recorded{' '}
          {new Date(stats.data.lastRecordedAt).toLocaleString('en-PK')}
        </p>
      )}

      <div aria-live="polite">
        {verify && (
          <p
            className={`mb-3 rounded-xl border-2 p-3 font-semibold ${verify.valid ? 'border-green-700 bg-green-50 text-green-900' : 'border-red-700 bg-red-50 text-red-900'}`}
          >
            {verify.valid
              ? `✓ Chain intact: ${verify.checked} entries verified. No entry has been edited or removed.`
              : `✗ Chain broken at entry #${verify.brokenAtSeq} (${verify.reason}). That record was changed after it was written.`}
          </p>
        )}
        {msg && (
          <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-red-900">
            {msg}
          </p>
        )}
      </div>

      <div role="group" aria-label="Quick filters" className="mb-3 flex flex-wrap gap-2">
        {QUICK_FILTERS.map((f) => (
          <button
            key={f.id}
            aria-pressed={query.quick === f.id && !query.type}
            onClick={() => {
              setFilters({ ...filters, type: '' });
              setQuery({ quick: f.id, type: '', entityId: query.entityId, cursor: '' });
            }}
            className={`min-h-12 rounded-lg border-2 px-3 text-sm font-medium ${query.quick === f.id && !query.type ? 'border-brand bg-brand-soft text-brand-dark' : 'border-slate-300 bg-white'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <form onSubmit={apply} className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          Exact event type
          <input
            value={filters.type}
            onChange={(e) => setFilters({ ...filters, type: e.target.value })}
            placeholder="cases.case.decided"
            className="mt-1 block min-h-12 rounded-lg border-2 border-slate-400 px-2"
          />
        </label>
        <label className="text-sm">
          Case / payment id
          <input
            value={filters.entityId}
            onChange={(e) => setFilters({ ...filters, entityId: e.target.value })}
            className="mt-1 block min-h-12 rounded-lg border-2 border-slate-400 px-2 font-mono"
          />
        </label>
        <Button type="submit" variant="ghost">
          Filter
        </Button>
      </form>

      {loading && !data ? (
        <Skeleton lines={8} />
      ) : error ? (
        <p role="alert">{staffError(error)}</p>
      ) : (
        <>
          <DataTable
            caption="Audit entries"
            rows={data?.items ?? []}
            rowKey={(e) => e.eventId}
            empty="No entries match."
            columns={[
              { header: '#', cell: (e) => e.seq },
              { header: 'When', cell: (e) => new Date(e.occurredAt).toLocaleString('en-PK') },
              {
                header: 'Event',
                cell: (e) => <StatusPill tone={eventTone(e.type)}>{eventLabel(e.type)}</StatusPill>,
              },
              { header: 'What happened', cell: (e) => eventSummary(e) || '—' },
              {
                header: 'Entity',
                cell: (e) => (
                  <span className="font-mono text-xs">{e.entityId?.slice(0, 8) ?? '—'}</span>
                ),
              },
              {
                header: 'Actor',
                cell: (e) => (
                  <span className="font-mono text-xs">{e.actorId?.slice(0, 14) ?? 'system'}</span>
                ),
              },
              {
                header: 'Hash',
                cell: (e) => <span className="font-mono text-xs">{e.hash.slice(0, 10)}…</span>,
              },
              {
                header: 'Open',
                cell: (e) => {
                  const caseId = caseOf(e);
                  return (
                    <span className="flex gap-3">
                      <button
                        className="min-h-10 text-sm text-brand underline"
                        disabled={busy}
                        onClick={() => open(() => api.auditEntry(e.eventId), setEntry)}
                      >
                        entry
                      </button>
                      {caseId && (
                        <button
                          className="min-h-10 text-sm text-brand underline"
                          disabled={busy}
                          onClick={() => open(() => loadTrace(caseId), setTrace)}
                        >
                          trace
                        </button>
                      )}
                    </span>
                  );
                },
              },
            ]}
          />
          <div className="mt-3 flex gap-2">
            {query.cursor && (
              <Button variant="ghost" onClick={() => setQuery({ ...query, cursor: '' })}>
                Newest
              </Button>
            )}
            {data?.nextCursor && (
              <Button
                variant="ghost"
                onClick={() => setQuery({ ...query, cursor: String(data.nextCursor) })}
              >
                Older →
              </Button>
            )}
          </div>
        </>
      )}

      {entry && (
        <Card className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">Entry #{entry.seq}</h2>
            <StatusPill tone={eventTone(entry.type)}>{eventLabel(entry.type)}</StatusPill>
            <button
              className="ml-auto min-h-12 px-2 text-sm underline"
              onClick={() => setEntry(null)}
            >
              Close
            </button>
          </div>
          <p className="mt-1 text-sm">{eventSummary(entry) || 'No summary for this event type.'}</p>
          <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted">Recorded type</dt>
            <dd className="font-mono text-xs">{entry.type}</dd>
            <dt className="text-muted">Service</dt>
            <dd>{entry.source}</dd>
            <dt className="text-muted">When</dt>
            <dd>{new Date(entry.occurredAt).toLocaleString('en-PK')}</dd>
            <dt className="text-muted">Actor</dt>
            <dd className="font-mono text-xs">{entry.actorId ?? 'system'}</dd>
            <dt className="text-muted">Entity</dt>
            <dd className="font-mono text-xs">{entry.entityId ?? '—'}</dd>
            <dt className="text-muted">Hash</dt>
            <dd className="break-all font-mono text-xs">{entry.hash}</dd>
          </dl>
          <details className="mt-2">
            <summary className="min-h-12 cursor-pointer py-3 text-sm font-medium text-brand underline">
              Raw JSON
            </summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
              {maskedJson(entry)}
            </pre>
          </details>
        </Card>
      )}

      {trace && <TraceView trace={trace} onClose={() => setTrace(null)} />}
    </Shell>
  );
}
