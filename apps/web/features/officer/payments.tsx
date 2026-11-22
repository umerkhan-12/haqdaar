'use client';

import { useState } from 'react';
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
import { api, ApiError, type Payment } from '@/lib/api';
import { useAsync } from '@/lib/hooks';

/** Bank and rail codes in words an officer can act on. */
function plainReason(code: string | null | undefined): string {
  if (!code) return 'No reason recorded';
  if (/AC0[134]|ACCOUNT_NOT_FOUND|not found|no such account/i.test(code))
    return 'The bank has no account for this mobile number. Ask the claimant for the correct number.';
  if (/timeout|UNKNOWN|no answer/i.test(code))
    return 'The bank did not answer. Ask the bank (inquiry) before paying again.';
  if (/RJCT|REJECT/i.test(code))
    return `The bank rejected the transfer (${code.replace(/^(RJCT|REQUEST_REJECTED):\s*/i, '')}).`;
  return code;
}

const STATE_TONE: Record<string, Tone> = {
  SUCCESS: 'ok',
  HELD: 'warn',
  FAILED: 'bad',
  UNKNOWN: 'warn',
  AWAITING_APPROVAL: 'info',
  REVERSED: 'neutral',
};

const FILTERS = ['', 'HELD', 'AWAITING_APPROVAL', 'UNKNOWN', 'SUCCESS', 'FAILED'];

/** Payouts with holds explained, and four-eyes approval (the releaser can never approve). */
export function OfficerPayments() {
  const [filter, setFilter] = useState('');
  const { data, error, loading, reload } = useAsync(
    () => api.payments(filter || undefined),
    [filter],
  );
  const [releasing, setReleasing] = useState<Payment | null>(null);
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
      reload();
    } catch (e) {
      setMessage(
        e instanceof ApiError && e.status === 403
          ? 'Four-eyes rule: you released this payout, so a different officer must approve it.'
          : staffError(e),
      );
    } finally {
      setBusy(false);
      setReleasing(null);
      setRetrying(null);
      setNote('');
    }
  }

  return (
    <Shell roles={['officer', 'admin']} wide>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">Payouts</h1>
        <label className="flex items-center gap-2 text-sm">
          State
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="min-h-12 rounded-lg border-2 border-slate-400 bg-white px-2"
          >
            {FILTERS.map((f) => (
              <option key={f} value={f}>
                {f || 'All'}
              </option>
            ))}
          </select>
        </label>
      </div>
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
        <DataTable
          caption="Payouts"
          rows={data ?? []}
          rowKey={(p) => p.id}
          empty="No payouts in this state."
          columns={[
            {
              header: 'Payout',
              cell: (p) => <span className="font-mono text-xs">{p.id.slice(0, 8)}</span>,
            },
            {
              header: 'State',
              cell: (p) => (
                <StatusPill tone={STATE_TONE[p.state] ?? 'neutral'}>{p.state}</StatusPill>
              ),
            },
            { header: 'Amount', cell: (p) => `Rs ${p.amount.toLocaleString('en-PK')}` },
            { header: 'Beneficiary', cell: (p) => p.creditorName },
            {
              header: 'Why held or failed',
              cell: (p) =>
                p.holdReason ? (
                  <span>
                    {p.holdReason}
                    {p.titleFetched && (
                      <span className="block text-xs text-muted">
                        account title “{p.titleFetched}” (match {p.titleMatchScore?.toFixed(2)})
                      </span>
                    )}
                  </span>
                ) : p.state === 'FAILED' || p.state === 'UNKNOWN' ? (
                  <span>{plainReason(p.transitions?.[0]?.reason)}</span>
                ) : (
                  '—'
                ),
            },
            {
              header: 'Action',
              cell: (p) =>
                p.state === 'HELD' ? (
                  <Button
                    variant="ghost"
                    className="min-h-10 text-sm"
                    disabled={busy}
                    onClick={() => setReleasing(p)}
                  >
                    Release…
                  </Button>
                ) : p.state === 'AWAITING_APPROVAL' ? (
                  <Button
                    className="min-h-10 text-sm"
                    disabled={busy}
                    onClick={() =>
                      act(() => api.approvePayment(p.id), 'Approved by a second officer. Sending.')
                    }
                  >
                    Approve
                  </Button>
                ) : p.state === 'UNKNOWN' ? (
                  // The bank did not answer in time: ask what happened. An inquiry never sends money again.
                  <Button
                    variant="ghost"
                    className="min-h-10 text-sm"
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
                ) : p.state === 'FAILED' ? (
                  <Button
                    variant="ghost"
                    className="min-h-10 text-sm"
                    disabled={busy}
                    onClick={() => {
                      setNewAlias('');
                      setRetrying(p);
                    }}
                  >
                    Retry…
                  </Button>
                ) : null,
            },
          ]}
        />
      )}
      <ConfirmDialog
        open={!!releasing}
        title="Release a held payout"
        confirmLabel="Release (needs a second officer to approve)"
        busy={busy || note.trim().length < 5}
        onClose={() => setReleasing(null)}
        onConfirm={() =>
          releasing &&
          act(
            () => api.release(releasing.id, note.trim()),
            'Released. A different officer must now approve it.',
          )
        }
      >
        <label className="block space-y-1">
          <span className="text-sm font-medium">How did you verify the account? (required)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full rounded-xl border-2 border-slate-400 p-2"
          />
        </label>
      </ConfirmDialog>
      <ConfirmDialog
        open={!!retrying}
        title="Retry a failed payout"
        confirmLabel="Send again"
        busy={busy}
        onClose={() => setRetrying(null)}
        onConfirm={() =>
          retrying &&
          (newAlias === '' || /^03\d{9}$/.test(newAlias)) &&
          act(
            () => api.paymentRetry(retrying.id, newAlias || undefined),
            newAlias
              ? 'Sent to the corrected number. The account is in the claimant’s name.'
              : 'Sent again with the same payment reference.',
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
            onChange={(e) => setNewAlias(e.target.value.replace(/\D/g, '').slice(0, 11))}
            inputMode="numeric"
            placeholder="03XXXXXXXXX"
            className="mt-1 w-full rounded-xl border-2 border-slate-400 p-2 font-normal"
          />
        </label>
        <p className="mt-1 text-xs text-muted">
          Leave empty to send to the same number. A new number is paid only if the bank’s account on
          it is in the claimant’s own name.
        </p>
        {newAlias !== '' && !/^03\d{9}$/.test(newAlias) && (
          <p className="mt-1 text-xs font-semibold text-red-700">Enter 11 digits: 03XXXXXXXXX</p>
        )}
      </ConfirmDialog>
    </Shell>
  );
}
