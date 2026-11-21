'use client';

import { useState } from 'react';
import { Shell } from '@/components/shell';
import { Button, Card, ConfirmDialog, DataTable, Skeleton, StatusPill, staffError } from '@/components/ui';
import { api } from '@/lib/api';
import { useAsync } from '@/lib/hooks';

const SCOPES = [
  { id: 'scam:check', label: 'Check messages for scams (telcos, banks)' },
  { id: 'cases:status', label: 'Read claim status' },
];

/** Partner API keys: shown once, stored hashed, scoped, revocable. */
export function AdminKeys() {
  const { data, error, loading, reload } = useAsync(() => api.apiKeys(), []);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['scam:check']);
  const [created, setCreated] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <Shell roles={['admin']} wide>
      <h1 className="mb-4 text-xl font-bold">Partner API keys</h1>
      <div className="grid gap-4 lg:grid-cols-[24rem_1fr]">
        <Card>
          <h2 className="text-lg font-bold">New key</h2>
          <label className="mt-2 block text-sm">
            Partner name
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 min-h-12 w-full rounded-lg border-2 border-slate-400 px-2" />
          </label>
          <fieldset className="mt-3 space-y-2">
            <legend className="text-sm font-medium">Allowed to</legend>
            {SCOPES.map((s) => (
              <label key={s.id} className="flex min-h-12 items-center gap-3">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={scopes.includes(s.id)}
                  onChange={(e) => setScopes((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))}
                />
                {s.label}
              </label>
            ))}
          </fieldset>
          <Button
            className="mt-3"
            disabled={name.trim().length < 3 || !scopes.length}
            onClick={async () => {
              try {
                const k = await api.createKey(name.trim(), scopes);
                setCreated(k.key);
                setName('');
                reload();
              } catch (e) {
                setMsg(staffError(e));
              }
            }}
          >
            Create key
          </Button>
          {created && (
            <div role="status" className="mt-3 rounded-xl border-2 border-amber-700 bg-amber-50 p-3 text-amber-900">
              <p className="font-semibold">Copy it now — it will never be shown again.</p>
              <code className="mt-1 block break-all font-mono text-sm">{created}</code>
            </div>
          )}
          {msg && <p role="alert">{msg}</p>}
        </Card>
        <div>
          {loading && !data ? (
            <Skeleton lines={4} />
          ) : error ? (
            <p role="alert">{staffError(error)}</p>
          ) : (
            <DataTable
              caption="API keys"
              rows={data ?? []}
              rowKey={(k) => k.id}
              empty="No keys yet."
              columns={[
                { header: 'Name', cell: (k) => k.name },
                { header: 'Key', cell: (k) => <span className="font-mono text-xs">{k.prefix}…</span> },
                { header: 'Scopes', cell: (k) => k.scopes.join(', ') },
                { header: 'Last used', cell: (k) => (k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('en-PK') : 'never') },
                {
                  header: 'Status',
                  cell: (k) =>
                    k.revokedAt ? (
                      <StatusPill tone="bad">revoked</StatusPill>
                    ) : (
                      <Button variant="ghost" className="min-h-10 text-sm" onClick={() => setRevoking(k.id)}>
                        Revoke…
                      </Button>
                    ),
                },
              ]}
            />
          )}
        </div>
      </div>
      <ConfirmDialog
        open={!!revoking}
        title="Revoke this key?"
        confirmLabel="Revoke"
        danger
        onClose={() => setRevoking(null)}
        onConfirm={async () => {
          if (revoking) await api.revokeKey(revoking).catch((e) => setMsg(staffError(e)));
          setRevoking(null);
          reload();
        }}
      >
        <p className="text-sm">The partner&apos;s requests stop working at once.</p>
      </ConfirmDialog>
    </Shell>
  );
}
