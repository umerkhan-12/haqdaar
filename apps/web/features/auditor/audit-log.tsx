'use client';

import { useState, type FormEvent } from 'react';
import { Shell } from '@/components/shell';
import { Button, Card, DataTable, Skeleton, StatusPill, staffError } from '@/components/ui';
import { api, type AuditEntry } from '@/lib/api';
import { useAsync } from '@/lib/hooks';

/** Read-only, tamper-evident record. Auditors filter, open a decision trace, and verify the hash chain. */
export function AuditLog() {
  const [filters, setFilters] = useState({ type: '', entityId: '' });
  const [query, setQuery] = useState({ type: '', entityId: '', cursor: '' });
  const qs = new URLSearchParams(Object.entries({ ...query, limit: '25' }).filter(([, v]) => v) as [string, string][]).toString();
  const { data, error, loading } = useAsync(() => api.audit(qs), [qs]);
  const [verify, setVerify] = useState<Awaited<ReturnType<typeof api.verifyChain>> | null>(null);
  const [trace, setTrace] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const apply = (e: FormEvent) => {
    e.preventDefault();
    setQuery({ ...filters, cursor: '' });
  };

  const decidedCase = (e: AuditEntry) =>
    e.type === 'cases.case.decided' ? (e.payload as { caseId?: string } | null)?.caseId : undefined;

  async function openTrace(caseId: string) {
    try {
      const c = await api.case(caseId);
      if (!c.decision) return setMsg('This case has no recorded decision.');
      setTrace(await api.trace(c.decision.id));
    } catch (err) {
      setMsg(staffError(err));
    }
  }

  return (
    <Shell roles={['auditor', 'admin']} wide>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-bold">Audit log</h1>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setVerify(await api.verifyChain());
            } catch (e) {
              setMsg(staffError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Verify chain
        </Button>
      </div>
      <div aria-live="polite">
        {verify && (
          <p className={`mb-3 rounded-xl border-2 p-3 font-semibold ${verify.valid ? 'border-green-700 bg-green-50 text-green-900' : 'border-red-700 bg-red-50 text-red-900'}`}>
            {verify.valid
              ? `✓ Chain intact: ${verify.checked} entries verified. No entry has been edited or removed.`
              : `✗ Chain broken at entry #${verify.brokenAtSeq} (${verify.reason}). That record was changed after it was written.`}
          </p>
        )}
        {msg && <p role="alert">{msg}</p>}
      </div>

      <form onSubmit={apply} className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          Event type
          <input value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })} placeholder="cases.case.decided" className="mt-1 block min-h-12 rounded-lg border-2 border-slate-400 px-2" />
        </label>
        <label className="text-sm">
          Case / payment id
          <input value={filters.entityId} onChange={(e) => setFilters({ ...filters, entityId: e.target.value })} className="mt-1 block min-h-12 rounded-lg border-2 border-slate-400 px-2 font-mono" />
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
              { header: 'Event', cell: (e) => <StatusPill>{e.type}</StatusPill> },
              { header: 'Entity', cell: (e) => <span className="font-mono text-xs">{e.entityId?.slice(0, 8) ?? '—'}</span> },
              { header: 'Actor', cell: (e) => <span className="font-mono text-xs">{e.actorId?.slice(0, 14) ?? 'system'}</span> },
              { header: 'Hash', cell: (e) => <span className="font-mono text-xs">{e.hash.slice(0, 10)}…</span> },
              {
                header: 'Trace',
                cell: (e) => {
                  const caseId = decidedCase(e);
                  return caseId ? (
                    <button className="min-h-10 text-sm text-brand underline" onClick={() => openTrace(caseId)}>
                      open
                    </button>
                  ) : null;
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
              <Button variant="ghost" onClick={() => setQuery({ ...query, cursor: String(data.nextCursor) })}>
                Older →
              </Button>
            )}
          </div>
        </>
      )}

      {trace ? (
        <Card className="mt-4">
          <div className="flex items-center">
            <h2 className="text-lg font-bold">Decision trace</h2>
            <button className="ml-auto min-h-12 px-2 text-sm underline" onClick={() => setTrace(null)}>
              Close
            </button>
          </div>
          <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(trace, null, 2)}</pre>
        </Card>
      ) : null}
    </Shell>
  );
}
