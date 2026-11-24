'use client';

import { useState, type ReactNode } from 'react';
import {
  Button,
  Card,
  ConfirmDialog,
  LinkButton,
  Skeleton,
  StatusPill,
  Timeline,
  laneTone,
  staffError,
} from '@/components/ui';
import { api, ApiError, type BasicStaffCase, type StaffCase } from '@/lib/api';
import { useAsync, useSession } from '@/lib/hooks';
import { AiNotesCard } from './ai-notes-card';
import { FraudSignalsCard } from './fraud-signals';
import { laneLabel, staffName, statusLabel, timelineLabel } from './labels';

type Action = 'approve' | 'reject' | 'info' | 'escalate' | 'close';

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
  approve: {
    title: 'Approve this claim',
    confirm: 'Approve and start the payout',
    prompt: 'Note for the citizen (optional, she hears it)',
    minChars: 0,
    done: 'Approved. Payout will start.',
    call: (id, text) => api.approve(id, text || undefined),
  },
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
    title: 'Escalate for a second look',
    confirm: 'Escalate',
    prompt: 'Why a senior officer or the admin should look (required, shown on the case)',
    minChars: 5,
    done: 'Escalated. The case moved to the top of the queue for a second look.',
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

const DONE_STATUSES = ['PAID', 'REJECTED', 'CLOSED'];

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

/** Runs one officer action; after a failure the case and queue are reloaded so no stale button stays. */
function useActions(reload: () => void, onDone: () => void) {
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
    } catch (e) {
      setMessage(staffError(e));
    } finally {
      setAction(null);
      setText('');
      setBusy(false);
      reload();
      onDone();
    }
  }

  function open(a: Action) {
    setText('');
    setAction(a);
  }

  return { action, setAction, open, text, setText, busy, message, run };
}

type Actions = ReturnType<typeof useActions>;

/** The dialog every action goes through, with its minimum length spelled out. */
function ActionDialog({
  caseId,
  a,
  children,
}: {
  caseId: string;
  a: Actions;
  children?: ReactNode;
}) {
  const dialog = a.action ? DIALOG[a.action] : null;
  const short = a.text.trim().length < (dialog?.minChars ?? 0);
  return (
    <ConfirmDialog
      open={dialog !== null}
      title={dialog?.title ?? ''}
      confirmLabel={dialog?.confirm ?? ''}
      danger={dialog?.danger}
      busy={a.busy || short}
      onClose={() => a.setAction(null)}
      onConfirm={() => dialog && a.run(() => dialog.call(caseId, a.text.trim()), dialog.done)}
    >
      {children}
      <label className="block space-y-1">
        <span className="text-sm font-medium">{dialog?.prompt}</span>
        <textarea
          maxLength={500}
          value={a.text}
          onChange={(e) => a.setText(e.target.value)}
          rows={3}
          className="w-full rounded-xl border-2 border-slate-400 p-2"
        />
      </label>
      {dialog && dialog.minChars > 0 && short && (
        <p className="text-xs text-muted">
          At least {dialog.minChars} characters ({a.text.trim().length} so far).
        </p>
      )}
    </ConfirmDialog>
  );
}

function Message({ text }: { text: string | null }) {
  return text ? (
    <p role="status" className="rounded-xl bg-slate-100 p-3">
      {text}
    </p>
  ) : null;
}

/** Everything an officer needs to decide one case, reachable by keyboard. */
export function CasePanel({ id, onDone }: { id: string; onDone: () => void }) {
  const { data: c, error, loading, reload } = useAsync<StaffCase>(() => api.staffCase(id), [id]);
  const me = useSession()?.userId;
  const a = useActions(reload, onDone);

  if (loading && !c) return <Skeleton lines={5} />;
  if (error instanceof ApiError && error.code === 'CONSENT_WITHDRAWN')
    return <ReducedPanel id={id} onDone={onDone} />;
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
  const account = c.payout.aliasMasked ?? c.payout.ibanMasked ?? '—';

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
          <dd>{c.district ?? c.person.district ?? '—'}</dd>
          <dt className="text-muted">Payout</dt>
          <dd className="font-mono">{account}</dd>
          <dt className="text-muted">Amount</dt>
          <dd>Rs {c.amount?.toLocaleString('en-PK') ?? '—'}</dd>
          <dt className="text-muted">Assigned to</dt>
          <dd>{staffName(c.assignedTo, me)}</dd>
        </dl>
        {c.escalated && (
          <p className="mt-2 rounded-lg border border-red-700 bg-red-50 p-2 text-sm text-red-900">
            Escalated for a second look
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

      <FraudSignalsCard anomalies={c.anomalies ?? []} />

      <AiNotesCard notes={c.aiNotes} typedCnicMasked={c.person.cnicMasked} flags={c.flags} />

      <div className="flex flex-wrap gap-2">
        {reviewable && (
          <>
            <Button disabled={a.busy} onClick={() => a.open('approve')}>
              Approve…
            </Button>
            <Button variant="danger" disabled={a.busy} onClick={() => a.open('reject')}>
              Reject…
            </Button>
            <Button variant="ghost" disabled={a.busy} onClick={() => a.open('info')}>
              Ask for info…
            </Button>
            {c.assignedTo !== me && (
              <Button
                variant="ghost"
                disabled={a.busy}
                onClick={() => a.run(() => api.assign(c.id), 'Assigned to you.')}
              >
                Assign to me
              </Button>
            )}
            {!c.escalated && (
              <Button variant="ghost" disabled={a.busy} onClick={() => a.open('escalate')}>
                Escalate…
              </Button>
            )}
          </>
        )}
        {closable && (
          <Button variant="ghost" disabled={a.busy} onClick={() => a.open('close')}>
            Close case…
          </Button>
        )}
      </div>
      <Message text={a.message} />
      {(c.status === 'APPROVED' || c.status === 'PAID') && (
        <LinkButton href={`/officer/payments?case=${c.id}`}>See this payout</LinkButton>
      )}

      <Card>
        <h3 className="mb-2 font-semibold">Timeline</h3>
        <Timeline
          done={DONE_STATUSES.includes(c.status)}
          events={c.timeline.map((e) => ({ label: timelineLabel(e, me), at: e.at }))}
        />
      </Card>

      <ActionDialog caseId={c.id} a={a}>
        {a.action === 'approve' && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-brand-soft p-3 text-sm">
            <dt className="text-muted">Claimant</dt>
            <dd>{c.person.fullName}</dd>
            <dt className="text-muted">Amount</dt>
            <dd className="font-semibold">Rs {c.amount?.toLocaleString('en-PK') ?? '—'}</dd>
            <dt className="text-muted">Paid to</dt>
            <dd className="font-mono">{account}</dd>
          </dl>
        )}
      </ActionDialog>
    </div>
  );
}

/**
 * The citizen withdrew consent: no name, CNIC, account or AI notes, only where the claim stands. An
 * officer can still say no (reject) or file a finished case away (close).
 */
function ReducedPanel({ id, onDone }: { id: string; onDone: () => void }) {
  const {
    data: c,
    error,
    loading,
    reload,
  } = useAsync<BasicStaffCase>(() => api.staffCaseBasic(id), [id]);
  const me = useSession()?.userId;
  const a = useActions(reload, onDone);

  if (loading && !c) return <Skeleton lines={4} />;
  if (error || !c)
    return (
      <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">
        {error ? staffError(error) : 'Case not found.'}
      </p>
    );

  const reviewable = c.status === 'IN_REVIEW' || c.status === 'NEEDS_INFO';
  const closable = c.status === 'PAID' || c.status === 'REJECTED';

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold">Claim {c.id.slice(0, 8)}</h2>
          <StatusPill tone={laneTone(c.lane)}>{laneLabel(c.lane)}</StatusPill>
          <StatusPill>{statusLabel(c.status)}</StatusPill>
        </div>
        <p className="mt-2 rounded-lg border border-amber-600 bg-amber-50 p-2 text-sm text-amber-900">
          The citizen withdrew consent, so her personal data is hidden. You can still reject the
          claim or close a finished one.
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Amount</dt>
          <dd>Rs {c.amount?.toLocaleString('en-PK') ?? '—'}</dd>
          <dt className="text-muted">Assigned to</dt>
          <dd>{staffName(c.assignedTo, me)}</dd>
        </dl>
      </Card>
      <div className="flex flex-wrap gap-2">
        {reviewable && (
          <Button variant="danger" disabled={a.busy} onClick={() => a.open('reject')}>
            Reject…
          </Button>
        )}
        {closable && (
          <Button variant="ghost" disabled={a.busy} onClick={() => a.open('close')}>
            Close case…
          </Button>
        )}
      </div>
      <Message text={a.message} />
      <Card>
        <h3 className="mb-2 font-semibold">Timeline</h3>
        <Timeline
          done={DONE_STATUSES.includes(c.status)}
          events={c.timeline.map((e) => ({ label: timelineLabel(e, me), at: e.at }))}
        />
      </Card>
      <ActionDialog caseId={c.id} a={a} />
    </div>
  );
}
