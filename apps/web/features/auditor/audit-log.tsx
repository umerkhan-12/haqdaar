'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Shell } from '@/components/shell';
import { Button, Card, DataTable, Skeleton, StatusPill, staffError } from '@/components/ui';
import { api, request, type AuditEntry } from '@/lib/api';
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

type ChainCheck = { checked: number } & (
  | { valid: true }
  | { valid: false; brokenAtSeq: number; reason: string }
  | { valid: false; inAnotherProgram: true }
);
const verifyChain = () => request<ChainCheck>('POST', '/audit/verify-chain', { body: {} });

/** A day picked in the date fields covers that whole local day. */
const dayStart = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : '');
const dayEnd = (d: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : '');

const params = (o: Record<string, string>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString();

interface Query {
  quick: QuickFilter;
  type: string;
  entityId: string;
  from: string;
  to: string;
  cursor: string;
}

/** One page of entries. A quick filter covers several exact event types, so it asks once per type and merges by sequence. */
async function loadEntries(q: Query) {
  const types = QUICK_FILTERS.find((f) => f.id === q.quick)?.types ?? [];
  const common = {
    entityId: q.entityId,
    from: dayStart(q.from),
    to: dayEnd(q.to),
    cursor: q.cursor,
    limit: String(PAGE),
  };
  if (!types.length) return api.audit(params({ type: q.type, ...common }));
  const pages = await Promise.all(types.map((type) => api.audit(params({ type, ...common }))));
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
  const [filters, setFilters] = useState({ type: '', entityId: '', from: '', to: '' });
  const [query, setQuery] = useState<Query>({
    quick: 'all',
    type: '',
    entityId: '',
    from: '',
    to: '',
    cursor: '',
  });
  /** Cursors of the pages before this one, so "Newer" goes back one page at a time. */
  const [newer, setNewer] = useState<string[]>([]);
  const entries = useAsync(() => loadEntries(query), [JSON.stringify(query)]);
  const { error, loading } = entries;
  /** A failed reload keeps the last page on screen (with a warning) instead of blanking it. */
  const [lastGood, setLastGood] = useState(entries.data);
  useEffect(() => {
    if (entries.data) setLastGood(entries.data);
  }, [entries.data]);
  const data = entries.data ?? lastGood;
  const stats = useAsync(() => api.auditStats(), []);
  const [verify, setVerify] = useState<ChainCheck | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const badRange = !!filters.from && !!filters.to && filters.from > filters.to;
  const restart = (q: Query) => {
    setNewer([]);
    setQuery(q);
  };
  const copy = (id: string) =>
    navigator.clipboard
      .writeText(id)
      .then(() => setCopied(id))
      .catch(() => setCopied(null));
  const [trace, setTrace] = useState<CaseTrace | null>(null);
  const [entry, setEntry] = useState<AuditEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const apply = (e: FormEvent) => {
    e.preventDefault();
    if (badRange) return;
    restart({ quick: filters.type ? 'all' : query.quick, ...filters, cursor: '' });
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
        <Button disabled={busy} onClick={() => open(verifyChain, setVerify)}>
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
              : 'inAnotherProgram' in verify
                ? '✗ Chain broken in an entry that belongs to another program. That record was changed after it was written; the platform team must look into it.'
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
              restart({ ...query, quick: f.id, type: '', cursor: '' });
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
          Case / payment id (or its start)
          <input
            value={filters.entityId}
            onChange={(e) => setFilters({ ...filters, entityId: e.target.value.trim() })}
            className="mt-1 block min-h-12 rounded-lg border-2 border-slate-400 px-2 font-mono"
          />
        </label>
        <label className="text-sm">
          From
          <input
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            className="mt-1 block min-h-12 rounded-lg border-2 border-slate-400 px-2"
          />
        </label>
        <label className="text-sm">
          To
          <input
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            className="mt-1 block min-h-12 rounded-lg border-2 border-slate-400 px-2"
          />
        </label>
        <Button type="submit" variant="ghost" disabled={badRange}>
          Filter
        </Button>
        {badRange && (
          <p role="alert" className="w-full text-sm text-red-900">
            The start day must be before the end day.
          </p>
        )}
      </form>

      {loading && data && (
        <p role="status" className="mb-2 text-sm text-muted">
          Loading…
        </p>
      )}
      {!!error && data && (
        <p role="alert" className="mb-2 rounded-xl bg-red-50 p-3 text-sm text-red-900">
          Could not load these entries: {staffError(error)} The list below is the last one loaded.
        </p>
      )}
      {loading && !data ? (
        <Skeleton lines={8} />
      ) : error && !data ? (
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
                cell: (e) =>
                  e.entityId ? (
                    <button
                      className="min-h-10 font-mono text-xs underline decoration-dotted"
                      title={`${e.entityId} (click to copy)`}
                      aria-label={`Copy id ${e.entityId}`}
                      onClick={() => copy(e.entityId!)}
                    >
                      {copied === e.entityId ? 'copied' : e.entityId.slice(0, 8)}
                    </button>
                  ) : (
                    '—'
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
              <>
                <Button
                  variant="ghost"
                  disabled={loading}
                  onClick={() => restart({ ...query, cursor: '' })}
                >
                  Newest
                </Button>
                <Button
                  variant="ghost"
                  disabled={loading}
                  onClick={() => {
                    setQuery({ ...query, cursor: newer.at(-1) ?? '' });
                    setNewer(newer.slice(0, -1));
                  }}
                >
                  ← Newer
                </Button>
              </>
            )}
            {data?.nextCursor && (
              <Button
                variant="ghost"
                disabled={loading}
                onClick={() => {
                  setNewer([...newer, query.cursor]);
                  setQuery({ ...query, cursor: String(data.nextCursor) });
                }}
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
