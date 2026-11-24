'use client';

import { useState } from 'react';
import { Shell } from '@/components/shell';
import { Button, Card, DataTable, Skeleton, StatusPill, staffError } from '@/components/ui';
import { api, request } from '@/lib/api';
import { useAsync } from '@/lib/hooks';

interface ReconItem {
  endToEndId: string;
  status: string;
  ourAmount: number | null;
  providerAmount: number | null;
  paymentId: string | null;
}
interface ReconRun {
  id: string;
  date: string;
  matched: number;
  mismatched: number;
  items: ReconItem[];
  createdAt: string;
}

const runReconciliation = () => request<ReconRun>('POST', '/reconciliation/run', { body: {} });
const pastRuns = () => request<ReconRun[]>('GET', '/reconciliation/runs');
const rupees = (n: number | null) => (n === null ? '—' : n.toLocaleString('en-PK'));

/** One run's problems. A bank paying twice gives two rows with the same id, so the position is in the key. */
function ReconItems({ run }: { run: ReconRun }) {
  const rows = run.items.map((item, n) => ({ ...item, n })).filter((i) => i.status !== 'matched');
  return (
    <div className="mt-3 space-y-2" aria-live="polite">
      <p>
        <StatusPill tone={run.mismatched ? 'bad' : 'ok'}>
          {run.date}: {run.matched} matched · {run.mismatched} mismatched
        </StatusPill>
      </p>
      <DataTable
        caption="Reconciliation items"
        rows={rows}
        rowKey={(i) => `${i.endToEndId}-${i.status}-${i.n}`}
        empty="Every payout matches the statement."
        columns={[
          {
            header: 'End-to-end id',
            cell: (i) => <span className="font-mono text-xs">{i.endToEndId}</span>,
          },
          {
            header: 'Problem',
            cell: (i) => <StatusPill tone="bad">{i.status}</StatusPill>,
          },
          { header: 'Ours (PKR)', cell: (i) => rupees(i.ourAmount), className: 'text-right' },
          {
            header: 'Bank (PKR)',
            cell: (i) => rupees(i.providerAmount),
            className: 'text-right',
          },
        ]}
      />
    </div>
  );
}

/** Double-entry ledger and reconciliation against the (mock) Raast statement. */
export function AdminMoney() {
  const { data, error, loading, reload } = useAsync(() => api.balances(), []);
  const runs = useAsync(pastRuns, []);
  const [recon, setRecon] = useState<ReconRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <Shell roles={['admin']} wide>
      <h1 className="mb-4 text-xl font-bold">Ledger and reconciliation</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-lg font-bold">Balances</h2>
            {data && (
              <StatusPill tone={data.balanced ? 'ok' : 'bad'}>
                {data.balanced ? 'debits = credits' : 'UNBALANCED'}
              </StatusPill>
            )}
            <button onClick={reload} className="ml-auto min-h-12 px-2 text-sm text-brand underline">
              Refresh
            </button>
          </div>
          {loading && !data ? (
            <Skeleton lines={3} />
          ) : error ? (
            <p role="alert">{staffError(error)}</p>
          ) : (
            <DataTable
              caption="Account balances"
              rows={data?.accounts ?? []}
              rowKey={(a) => a.account}
              empty="No ledger entries yet."
              columns={[
                {
                  header: 'Account',
                  cell: (a) => <span className="font-mono text-xs">{a.account}</span>,
                },
                {
                  header: 'Balance (PKR)',
                  cell: (a) => a.balance.toLocaleString('en-PK'),
                  className: 'text-right',
                },
              ]}
            />
          )}
        </Card>
        <Card>
          <h2 className="text-lg font-bold">Reconciliation</h2>
          <p className="text-sm text-muted">
            Matches every settled payout with the (simulated) bank statement by end-to-end id.
          </p>
          <Button
            className="mt-3"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setMsg(null);
              try {
                setRecon(await runReconciliation());
                runs.reload();
              } catch (e) {
                setMsg(staffError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Run reconciliation
          </Button>
          {msg && <p role="alert">{msg}</p>}
          {recon && <ReconItems run={recon} />}
          <h3 className="mt-5 font-semibold">Past runs</h3>
          {runs.loading && !runs.data ? (
            <Skeleton lines={2} />
          ) : runs.error ? (
            <p role="alert">{staffError(runs.error)}</p>
          ) : (
            <DataTable
              caption="Past reconciliation runs"
              rows={runs.data ?? []}
              rowKey={(r) => r.id}
              empty="No runs yet."
              columns={[
                { header: 'Statement day', cell: (r) => r.date },
                { header: 'Run at', cell: (r) => new Date(r.createdAt).toLocaleString('en-PK') },
                { header: 'Matched', cell: (r) => r.matched, className: 'text-right' },
                { header: 'Mismatched', cell: (r) => r.mismatched, className: 'text-right' },
                {
                  header: 'Details',
                  cell: (r) => (
                    <Button
                      variant="ghost"
                      className="min-h-10 text-sm"
                      aria-pressed={recon?.id === r.id}
                      onClick={() => setRecon(r)}
                    >
                      {recon?.id === r.id ? 'Showing' : 'Show'}
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </Card>
      </div>
    </Shell>
  );
}
