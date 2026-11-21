'use client';

import { useState } from 'react';
import { Shell } from '@/components/shell';
import { Button, Card, DataTable, Skeleton, StatusPill, staffError } from '@/components/ui';
import { api } from '@/lib/api';
import { useAsync } from '@/lib/hooks';

type Recon = Awaited<ReturnType<typeof api.reconcile>>;

/** Double-entry ledger and reconciliation against the (mock) Raast statement. */
export function AdminMoney() {
  const { data, error, loading, reload } = useAsync(() => api.balances(), []);
  const [recon, setRecon] = useState<Recon | null>(null);
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
            Matches every settled payout with the bank statement by end-to-end id.
          </p>
          <Button
            className="mt-3"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setMsg(null);
              try {
                setRecon(await api.reconcile());
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
          {recon && (
            <div className="mt-3 space-y-2" aria-live="polite">
              <p>
                <StatusPill tone={recon.mismatched ? 'bad' : 'ok'}>
                  {recon.matched} matched · {recon.mismatched} mismatched
                </StatusPill>
              </p>
              <DataTable
                caption="Reconciliation items"
                rows={recon.items.filter((i) => i.status !== 'matched')}
                rowKey={(i) => `${i.endToEndId}-${i.status}`}
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
                ]}
              />
            </div>
          )}
        </Card>
      </div>
    </Shell>
  );
}
