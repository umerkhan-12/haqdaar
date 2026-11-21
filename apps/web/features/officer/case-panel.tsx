'use client';

import { useState } from 'react';
import {
  Button,
  Card,
  ConfirmDialog,
  Skeleton,
  StatusPill,
  Timeline,
  laneTone,
  staffError,
} from '@/components/ui';
import { api, type StaffCase } from '@/lib/api';
import { useAsync, useSession } from '@/lib/hooks';
import { AiNotesCard } from './ai-notes-card';
import { laneLabel, staffName, statusLabel, timelineLabel } from './labels';

type Action = 'reject' | 'info' | 'escalate' | 'close';

/** One place for every dialog: its words, whether text is required, and the call it makes. */
const DIALOG: Record<
  Action,
  {
    title: string;
    confirm: string;
    prompt: string;
    minChars: number;
    danger?: boolean;
    done: string;
    call: (id: string, text: string) => Promise<unknown>;
  }
> = {
  reject: {
    title: 'Reject this claim',
    confirm: 'Reject',
    prompt: 'Reason (required, the citizen hears it)',
    minChars: 5,
    danger: true,
    done: 'Rejected. The citizen will hear the reason.',
    call: (id, text) => api.reject(id, text),
  },
  info: {
    title: 'Ask the citizen for information',
    confirm: 'Send request',
    prompt: 'What is needed',
    minChars: 5,
    done: 'Request sent.',
    call: (id, text) => api.requestInfo(id, text),
  },
  escalate: {
    title: 'Escalate to a supervisor',
    confirm: 'Escalate',
    prompt: 'Why a supervisor should look (required, shown on the case)',
    minChars: 5,
    done: 'Escalated. The case moved to the top of the queue for a supervisor.',
    call: (id, text) => api.escalate(id, text),
  },
  close: {
    title: 'Close this case',
    confirm: 'Close case',
    prompt: 'Closing note (optional)',
    minChars: 0,
    done: 'Case closed.',
    call: (id, text) => api.closeCase(id, text || undefined),
  },
};

function clauseList(d: NonNullable<StaffCase['decision']>) {
  const c = d.clauses;
  const rows = Array.isArray(c)
    ? c.map((x) => ({ id: x.id, ok: x.passed ?? x.ok ?? false, text: x.textEn }))
    : Object.entries(c).map(([id, ok]) => ({ id, ok, text: undefined }));
  return rows.map((r) => ({
    id: r.id,
    ok: r.ok,
    text: r.text ?? d.clauseTexts[r.id] ?? r.id.replace(/_/g, ' '),
  }));
}

/** Everything an officer needs to decide one case, reachable by keyboard. */
export function CasePanel({ id, onDone }: { id: string; onDone: () => void }) {
  const { data: c, error, loading, reload } = useAsync<StaffCase>(() => api.staffCase(id), [id]);
  const me = useSession()?.userId;
  const [action, setAction] = useState<Action | null>(null);
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
      setAction(null);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !c) return <Skeleton lines={5} />;
  if (error)
    return (
      <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">
        {staffError(error)}
      </p>
    );
  if (!c) return null;

  const reviewable = c.status === 'IN_REVIEW' || c.status === 'NEEDS_INFO';
  const closable = c.status === 'PAID' || c.status === 'REJECTED';
  const d = c.decision;
  const dialog = action ? DIALOG[action] : null;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold">{c.person.fullName}</h2>
          <StatusPill tone={laneTone(c.lane)}>{laneLabel(c.lane)}</StatusPill>
          <StatusPill>{statusLabel(c.status)}</StatusPill>
          {c.escalated && <StatusPill tone="bad">Escalated</StatusPill>}
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">CNIC</dt>
          <dd className="font-mono">{c.person.cnicMasked}</dd>
          <dt className="text-muted">District</dt>
          <dd>{c.person.district ?? '—'}</dd>
          <dt className="text-muted">Payout</dt>
          <dd className="font-mono">{c.payout.aliasMasked ?? c.payout.ibanMasked ?? '—'}</dd>
          <dt className="text-muted">Amount</dt>
          <dd>Rs {c.amount?.toLocaleString('en-PK') ?? '—'}</dd>
          <dt className="text-muted">Assigned to</dt>
          <dd>{staffName(c.assignedTo, me)}</dd>
        </dl>
        {c.escalated && (
          <p className="mt-2 rounded-lg border border-red-700 bg-red-50 p-2 text-sm text-red-900">
            Escalated to a supervisor
            {c.escalatedAt ? ` on ${new Date(c.escalatedAt).toLocaleString('en-PK')}` : ''}
            {c.escalationReason ? `: “${c.escalationReason}”` : '.'}
          </p>
        )}
      </Card>

      {d && (
        <Card>
          <h3 className="font-semibold">Decision</h3>
          <p className="mt-1 text-sm text-muted">
            Decided under rule {d.ruleVersion === null ? '—' : `v${d.ruleVersion}`} · confidence{' '}
            {d.confidence.toFixed(3)} vs auto-approve threshold {d.threshold.toFixed(3)} · decided
            by {d.decidedBy}
          </p>
          <p className="mt-2 text-sm">{d.explanationEn}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {clauseList(d).map((cl) => (
              <li key={cl.id} className="flex items-center gap-2">
                <StatusPill tone={cl.ok ? 'ok' : 'bad'}>{cl.ok ? 'met' : 'not met'}</StatusPill>
                {cl.text}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <AiNotesCard notes={c.aiNotes} typedCnicMasked={c.person.cnicMasked} flags={c.flags} />

      <div className="flex flex-wrap gap-2">
        {reviewable && (
          <>
            <Button
              disabled={busy}
              onClick={() =>
                run(() => api.approve(c.id, 'Approved by officer'), 'Approved. Payout will start.')
              }
            >
              Approve
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => setAction('reject')}>
              Reject…
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setAction('info')}>
              Ask for info…
            </Button>
            {c.assignedTo !== me && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => run(() => api.assign(c.id), 'Assigned to you.')}
              >
                Assign to me
              </Button>
            )}
            {!c.escalated && (
              <Button variant="ghost" disabled={busy} onClick={() => setAction('escalate')}>
                Escalate…
              </Button>
            )}
          </>
        )}
        {closable && (
          <Button variant="ghost" disabled={busy} onClick={() => setAction('close')}>
            Close case…
          </Button>
        )}
      </div>
      {message && (
        <p role="status" className="rounded-xl bg-slate-100 p-3">
          {message}
        </p>
      )}

      <Card>
        <h3 className="mb-2 font-semibold">Timeline</h3>
        <Timeline events={c.timeline.map((e) => ({ label: timelineLabel(e, me), at: e.at }))} />
      </Card>

      <ConfirmDialog
        open={dialog !== null}
        title={dialog?.title ?? ''}
        confirmLabel={dialog?.confirm ?? ''}
        danger={dialog?.danger}
        busy={busy || text.trim().length < (dialog?.minChars ?? 0)}
        onClose={() => setAction(null)}
        onConfirm={() => dialog && run(() => dialog.call(c.id, text.trim()), dialog.done)}
      >
        <label className="block space-y-1">
          <span className="text-sm font-medium">{dialog?.prompt}</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="w-full rounded-xl border-2 border-slate-400 p-2"
          />
        </label>
      </ConfirmDialog>
    </div>
  );
}
