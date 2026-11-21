'use client';

import { useState } from 'react';
import { Button, Card, ConfirmDialog, Skeleton, StatusPill, Timeline, laneTone, staffError } from '@/components/ui';
import { api, type CaseDetail } from '@/lib/api';
import { useAsync } from '@/lib/hooks';

type Action = 'reject' | 'info' | null;

function clauseList(d: CaseDetail['decision']) {
  if (!d) return [];
  const c = d.clauses;
  if (Array.isArray(c)) return c.map((x) => ({ id: x.id, ok: x.passed ?? x.ok ?? false, text: x.textEn ?? x.id }));
  return Object.entries(c).map(([id, ok]) => ({ id, ok, text: id }));
}

/** Everything an officer needs to decide one case, reachable by keyboard. */
export function CasePanel({ id, onDone }: { id: string; onDone: () => void }) {
  const { data: c, error, loading, reload } = useAsync<CaseDetail>(() => api.case(id), [id]);
  const [action, setAction] = useState<Action>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage(done);
      setAction(null);
      setText('');
      reload();
      onDone();
    } catch (e) {
      setMessage(staffError(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !c) return <Skeleton lines={5} />;
  if (error) return <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">{staffError(error)}</p>;
  if (!c) return null;

  const decided = ['APPROVED', 'REJECTED', 'PAID', 'CLOSED'].includes(c.status);
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold">{c.person.fullName}</h2>
          <StatusPill tone={laneTone(c.lane)}>{c.lane ?? 'NEW'}</StatusPill>
          <StatusPill>{c.status}</StatusPill>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">CNIC</dt>
          <dd className="font-mono">{c.person.cnicMasked}</dd>
          <dt className="text-muted">District</dt>
          <dd>{c.person.district ?? '—'}</dd>
          <dt className="text-muted">Payout</dt>
          <dd className="font-mono">{c.payout.aliasMasked ?? c.payout.ibanMasked ?? '—'}</dd>
          <dt className="text-muted">Confidence</dt>
          <dd>{c.confidence?.toFixed(3) ?? '—'}</dd>
          <dt className="text-muted">Amount</dt>
          <dd>Rs {c.amount?.toLocaleString('en-PK') ?? '—'}</dd>
        </dl>
        {c.flags.length > 0 && (
          <p className="mt-2 flex flex-wrap gap-1">
            {c.flags.map((f) => (
              <StatusPill key={f} tone="warn">
                {f}
              </StatusPill>
            ))}
          </p>
        )}
      </Card>

      {c.decision && (
        <Card>
          <h3 className="font-semibold">Decision ({c.decision.decidedBy})</h3>
          <p className="mt-1 text-sm">{c.decision.explanationEn}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {clauseList(c.decision).map((cl) => (
              <li key={cl.id} className="flex items-center gap-2">
                <StatusPill tone={cl.ok ? 'ok' : 'bad'}>{cl.ok ? 'pass' : 'fail'}</StatusPill>
                {cl.text}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!decided && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => run(() => api.approve(c.id, 'Approved by officer'), 'Approved. Payout will start.')}>
            Approve
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => setAction('reject')}>
            Reject…
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setAction('info')}>
            Ask for info…
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="rounded-xl bg-slate-100 p-3">
          {message}
        </p>
      )}

      <Card>
        <h3 className="mb-2 font-semibold">Timeline</h3>
        <Timeline events={c.timeline.map((e) => ({ label: `${e.type.replace(/_/g, ' ')} · ${e.actor.slice(0, 8)}`, at: e.at }))} />
      </Card>

      <ConfirmDialog
        open={action !== null}
        title={action === 'reject' ? 'Reject this claim' : 'Ask the citizen for information'}
        confirmLabel={action === 'reject' ? 'Reject' : 'Send request'}
        danger={action === 'reject'}
        busy={busy || text.trim().length < 5}
        onClose={() => setAction(null)}
        onConfirm={() =>
          action === 'reject'
            ? run(() => api.reject(c.id, text.trim()), 'Rejected. The citizen will hear the reason.')
            : run(() => api.requestInfo(c.id, text.trim()), 'Request sent.')
        }
      >
        <label className="block space-y-1">
          <span className="text-sm font-medium">{action === 'reject' ? 'Reason (required, the citizen hears it)' : 'What is needed'}</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="w-full rounded-xl border-2 border-slate-400 p-2" />
        </label>
      </ConfirmDialog>
    </div>
  );
}
