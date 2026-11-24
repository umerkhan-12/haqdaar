'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Shell } from '@/components/shell';
import {
  Button,
  ConfirmDialog,
  DataTable,
  Skeleton,
  StatusPill,
  staffError,
  type Tone,
} from '@/components/ui';
import { typedMobile } from '@/features/citizen/claim-words';
import { api, ApiError, type Payment } from '@/lib/api';
import { useAsync, useSession } from '@/lib/hooks';
import { paymentStateLabel, plainReason } from './labels';

const STATE_TONE: Record<string, Tone> = {
  SUCCESS: 'ok',
  HELD: 'warn',
  FAILED: 'bad',
  UNKNOWN: 'warn',
  AWAITING_APPROVAL: 'info',
  SENT: 'info',
  REVERSAL_REQUESTED: 'warn',
  REVERSED: 'neutral',
};

const FILTERS = [
  '',
  'HELD',
  'AWAITING_APPROVAL',
  'SENT',
  'UNKNOWN',
  'SUCCESS',
  'FAILED',
  'REVERSAL_REQUESTED',
  'REVERSED',
];

const PAGE = 50;
const RETRY_WAITING = 'RETRY_AWAITING_APPROVAL';
const MAKER_ACTIONS = ['CLAIM_APPROVE', 'RELEASE', 'RETRY_REQUEST'];

function ago(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return new Date(iso).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' });
}

/** Everyone who asked for this payout to go out: none of them may approve it. */
const makers = (p: Payment) => [
  p.makerId,
  ...(p.approvals ?? []).filter((a) => MAKER_ACTIONS.includes(a.action)).map((a) => a.actorId),
];
const reversalRequester = (p: Payment) =>
  (p.approvals ?? []).find((a) => a.action === 'REVERSAL_REQUEST')?.actorId;

const validAlias = (v: string) => v === '' || /^03\d{9}$/.test(v);

function MinHint({ text, min }: { text: string; min: number }) {
  return text.trim().length < min ? (
    <p className="mt-1 text-xs text-muted">
      At least {min} characters ({text.trim().length} so far).
    </p>
  ) : null;
}

/** Payouts with holds explained, and four-eyes approval (whoever asked for a payout never approves it). */
export function OfficerPayments() {
  // Opened from a case ("See this payout"): show only that claim's payout.
  const caseId = useSearchParams().get('case') ?? undefined;
  const me = useSession()?.userId;
  const [filter, setFilter] = useState('');
  const [find, setFind] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(find.trim()), 300);
    return () => clearTimeout(t);
  }, [find]);
  const query = { state: filter || undefined, caseId, q: q || undefined };
  const { data, error, loading, reload } = useAsync(() => api.payments(query), [filter, caseId, q]);
  // Further pages, newest first, after the first one; reset whenever the first page reloads.
  const [more, setMore] = useState<Payment[]>([]);
  const [end, setEnd] = useState(false);
  const [paging, setPaging] = useState(false);
  useEffect(() => {
    setMore([]);
    setEnd((data?.length ?? 0) < PAGE);
  }, [data]);
  const rows = [...(data ?? []), ...more];

  async function loadMore() {
    const last = rows.at(-1);
    if (!last) return;
    setPaging(true);
    try {
      const page = await api.payments({ ...query, after: last.id });
      setMore((m) => [...m, ...page]);
      setEnd(page.length < PAGE);
    } catch (e) {
      setMessage(staffError(e));
    } finally {
      setPaging(false);
    }
  }

  const [releasing, setReleasing] = useState<Payment | null>(null);
  const [approving, setApproving] = useState<Payment | null>(null);
  const [reversing, setReversing] = useState<Payment | null>(null);
  const [approvingReversal, setApprovingReversal] = useState<Payment | null>(null);
  const [note, setNote] = useState('');
  const [retrying, setRetrying] = useState<Payment | null>(null);
  const [newAlias, setNewAlias] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage(ok);
    } catch (e) {
      setMessage(
        e instanceof ApiError && e.status === 403 && e.code === 'FOUR_EYES'
          ? e.message
          : staffError(e),
      );
    } finally {
      setBusy(false);
      setReleasing(null);
      setRetrying(null);
      setApproving(null);
      setReversing(null);
      setApprovingReversal(null);
      setNote('');
      reload();
    }
  }

  function action(p: Payment) {
    const small = 'min-h-10 text-sm';
    const mine = !!me && makers(p).includes(me);
    const waitingNote = (
      <span className="text-xs text-muted">You asked for it: a different officer approves.</span>
    );
    switch (p.state) {
      case 'HELD':
        return (
          <Button
            variant="ghost"
            className={small}
            disabled={busy}
            onClick={() => {
              setNewAlias('');
              setNote('');
              setReleasing(p);
            }}
          >
            Release…
          </Button>
        );
      case 'AWAITING_APPROVAL':
        return mine ? (
          waitingNote
        ) : (
          <Button className={small} disabled={busy} onClick={() => setApproving(p)}>
            Approve…
          </Button>
        );
      case 'UNKNOWN':
        // The bank did not answer in time: ask what happened. An inquiry never sends money again.
        return (
          <Button
            variant="ghost"
            className={small}
            disabled={busy}
            onClick={() =>
              act(
                () => api.paymentInquiry(p.id),
                'Asked the bank. The payout now shows its real result.',
              )
            }
          >
            Ask bank (inquiry)
          </Button>
        );
      case 'FAILED':
        if (p.holdReason === RETRY_WAITING)
          return mine ? (
            waitingNote
          ) : (
            <Button className={small} disabled={busy} onClick={() => setApproving(p)}>
              Approve retry…
            </Button>
          );
        return (
          <Button
            variant="ghost"
            className={small}
            disabled={busy}
            onClick={() => {
              setNewAlias('');
              setRetrying(p);
            }}
          >
            Retry…
          </Button>
        );
      case 'SUCCESS':
        return (
          <Button
            variant="ghost"
            className={small}
            disabled={busy}
            onClick={() => {
              setNote('');
              setReversing(p);
            }}
          >
            Request reversal…
          </Button>
        );
      case 'REVERSAL_REQUESTED':
        return me && reversalRequester(p) === me ? (
          waitingNote
        ) : (
          <Button className={small} disabled={busy} onClick={() => setApprovingReversal(p)}>
            Approve reversal…
          </Button>
        );
      default:
        return null;
    }
  }

  function why(p: Payment) {
    if (p.holdReason)
      return (
        <span>
          {plainReason(p.holdReason)}
          {p.titleFetched && (
            <span className="block text-xs text-muted">
              account title “{p.titleFetched}” (match {p.titleMatchScore?.toFixed(2)})
            </span>
          )}
        </span>
      );
    if (['FAILED', 'UNKNOWN', 'AWAITING_APPROVAL', 'REVERSAL_REQUESTED'].includes(p.state))
      return <span>{plainReason(p.transitions?.[0]?.reason)}</span>;
    return '—';
  }

  const summary = (p: Payment | null) =>
    p && (
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-brand-soft p-3 text-sm">
        <dt className="text-muted">Amount</dt>
        <dd className="font-semibold">Rs {p.amount.toLocaleString('en-PK')}</dd>
        <dt className="text-muted">Beneficiary</dt>
        <dd>{p.creditorName}</dd>
        <dt className="text-muted">Account</dt>
        <dd className="font-mono">
          {p.creditorAlias ? `*******${p.creditorAlias.slice(-4)}` : '—'}
        </dd>
      </dl>
    );

  return (
    <Shell roles={['officer', 'admin']} wide>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">Payouts</h1>
        <button onClick={reload} className="min-h-12 rounded-lg px-3 text-sm text-brand underline">
          Refresh
        </button>
        <label className="flex items-center gap-2 text-sm">
          State
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="min-h-12 rounded-lg border-2 border-slate-400 bg-white px-2"
          >
            {FILTERS.map((f) => (
              <option key={f} value={f}>
                {f ? paymentStateLabel(f) : 'All'}
              </option>
            ))}
          </select>
        </label>
      </div>
      {caseId ? (
        <p className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-brand-soft p-3 text-sm">
          Showing the payout for claim <span className="font-mono">{caseId.slice(0, 8)}</span>.
          <a href="/officer/payments" className="text-brand underline">
            Show all payouts
          </a>
        </p>
      ) : (
        <input
          type="search"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="Find: beneficiary name, or full claim or payout id"
          aria-label="Find a payout"
          className="mb-3 min-h-12 w-full rounded-lg border-2 border-slate-300 bg-white px-3 text-sm"
        />
      )}
      {message && (
        <p role="status" className="mb-3 rounded-xl bg-slate-100 p-3">
          {message}
        </p>
      )}
      {loading && !data ? (
        <Skeleton lines={5} />
      ) : error ? (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">
          {staffError(error)}
        </p>
      ) : (
        <>
          <DataTable
            caption="Payouts"
            rows={rows}
            rowKey={(p) => p.id}
            empty={
              caseId
                ? 'The payout for this claim is being prepared. Refresh in a few seconds.'
                : q
                  ? `No payout matches “${q}”.`
                  : 'No payouts in this state.'
            }
            columns={[
              {
                header: 'Payout',
                cell: (p) => <span className="font-mono text-xs">{p.id.slice(0, 8)}</span>,
              },
              {
                header: 'Claim',
                cell: (p) => (
                  <Link
                    href={`/officer?case=${p.caseId}`}
                    className="font-mono text-xs text-brand underline"
                    aria-label={`Open claim ${p.caseId.slice(0, 8)}`}
                  >
                    {p.caseId.slice(0, 8)}
                  </Link>
                ),
              },
              { header: 'Created', cell: (p) => ago(p.createdAt) },
              {
                header: 'State',
                cell: (p) => (
                  <StatusPill tone={STATE_TONE[p.state] ?? 'neutral'}>
                    {p.holdReason === RETRY_WAITING
                      ? 'Retry waiting for a second officer'
                      : paymentStateLabel(p.state)}
                  </StatusPill>
                ),
              },
              { header: 'Amount', cell: (p) => `Rs ${p.amount.toLocaleString('en-PK')}` },
              { header: 'Beneficiary', cell: (p) => p.creditorName },
              { header: 'Why held, failed or waiting', cell: why },
              { header: 'Action', cell: action },
            ]}
          />
          {!caseId && !end && rows.length > 0 && (
            <Button
              variant="ghost"
              className="mt-3 w-full"
              disabled={paging}
              onClick={() => void loadMore()}
            >
              {paging ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </>
      )}
      <ConfirmDialog
        open={!!approving}
        title={
          approving?.state === 'FAILED'
            ? 'Approve sending this payout again'
            : 'Approve this payout'
        }
        confirmLabel="Approve and send"
        busy={busy}
        onClose={() => setApproving(null)}
        onConfirm={() =>
          approving &&
          act(() => api.approvePayment(approving.id), 'Approved by a second officer. Sending.')
        }
      >
        {summary(approving)}
        <p className="text-sm">
          Money leaves the program account as soon as you approve. You are the second officer: check
          the amount and the beneficiary.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={!!reversing}
        title="Request a reversal"
        confirmLabel="Request reversal (a second officer approves)"
        danger
        busy={busy || note.trim().length < 5}
        onClose={() => setReversing(null)}
        onConfirm={() =>
          reversing &&
          act(
            () => api.requestReversal(reversing.id, note.trim()),
            'Reversal requested. A different officer must approve it.',
          )
        }
      >
        {summary(reversing)}
        <label className="block space-y-1">
          <span className="text-sm font-medium">Why must this payout be reversed? (required)</span>
          <textarea
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full rounded-xl border-2 border-slate-400 p-2"
          />
        </label>
        <MinHint text={note} min={5} />
      </ConfirmDialog>
      <ConfirmDialog
        open={!!approvingReversal}
        title="Approve this reversal"
        confirmLabel="Approve reversal"
        danger
        busy={busy}
        onClose={() => setApprovingReversal(null)}
        onConfirm={() =>
          approvingReversal &&
          act(
            () => api.approveReversal(approvingReversal.id),
            'Reversal approved. The ledger shows the money returned.',
          )
        }
      >
        {summary(approvingReversal)}
        <p className="text-sm">
          Reason given: {plainReason(approvingReversal?.transitions?.[0]?.reason)}
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={!!releasing}
        title="Release a held payout"
        confirmLabel="Release (needs a second officer to approve)"
        busy={busy || note.trim().length < 5 || !validAlias(newAlias)}
        onClose={() => setReleasing(null)}
        onConfirm={() =>
          releasing &&
          act(
            () => api.release(releasing.id, note.trim(), newAlias || undefined),
            newAlias
              ? 'Released to the corrected number (the account is in the claimant’s name). A different officer must now approve it.'
              : 'Released. A different officer must now approve it.',
          )
        }
      >
        {summary(releasing)}
        <p className="text-sm">Held because: {plainReason(releasing?.holdReason)}</p>
        <label className="block space-y-1">
          <span className="text-sm font-medium">How did you verify the account? (required)</span>
          <textarea
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full rounded-xl border-2 border-slate-400 p-2"
          />
        </label>
        <MinHint text={note} min={5} />
        <label className="mt-3 block text-sm font-semibold">
          Corrected mobile account number from the claimant (optional)
          <input
            value={newAlias}
            onChange={(e) => setNewAlias(typedMobile(e.target.value))}
            inputMode="numeric"
            placeholder="03XXXXXXXXX"
            className="mt-1 w-full rounded-xl border-2 border-slate-400 p-2 font-normal"
          />
        </label>
        <p className="mt-1 text-xs text-muted">
          Use this when the hold is “account not found” or “name does not match”. The new number is
          accepted only if the bank’s account on it is in the claimant’s own name.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={!!retrying}
        title="Retry a failed payout"
        confirmLabel="Send again"
        busy={busy || !validAlias(newAlias)}
        onClose={() => setRetrying(null)}
        onConfirm={() =>
          retrying &&
          validAlias(newAlias) &&
          act(
            () => api.paymentRetry(retrying.id, newAlias || undefined),
            newAlias
              ? 'Corrected number checked: the account is in the claimant’s name. A different officer must approve sending to it.'
              : 'Sent again with the same payment reference (or, for a large amount, waiting for a second officer).',
          )
        }
      >
        <p className="text-sm">
          Rs {retrying?.amount.toLocaleString('en-PK')} to {retrying?.creditorName}. The retry
          reuses the same payment reference, so the bank cannot pay it twice.
        </p>
        <label className="mt-3 block text-sm font-semibold">
          Corrected mobile account number from the claimant (optional)
          <input
            value={newAlias}
            onChange={(e) => setNewAlias(typedMobile(e.target.value))}
            inputMode="numeric"
            placeholder="03XXXXXXXXX"
            className="mt-1 w-full rounded-xl border-2 border-slate-400 p-2 font-normal"
          />
        </label>
        <p className="mt-1 text-xs text-muted">
          Leave empty to send to the same number. A new number is paid only if the bank’s account on
          it is in the claimant’s own name, and only after a different officer approves.
        </p>
        {!validAlias(newAlias) && (
          <p className="mt-1 text-xs font-semibold text-red-700">Enter 11 digits: 03XXXXXXXXX</p>
        )}
      </ConfirmDialog>
    </Shell>
  );
}
