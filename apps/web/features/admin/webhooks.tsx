'use client';

import { useState } from 'react';
import { Shell } from '@/components/shell';
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Skeleton,
  StatusPill,
  staffError,
  type Tone,
} from '@/components/ui';
import { api, request, type WebhookDelivery, type WebhookSubscription } from '@/lib/api';
import { useAsync } from '@/lib/hooks';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-PK') : '—');
/** Same rule as the server: https with a dotted host name or address. */
const HTTPS_URL = /^https:\/\/[^\s/?#]+\.[^\s/?#]+([/?#]\S*)?$/;
const deliveryTone = (status: string): Tone =>
  status === 'DELIVERED' ? 'ok' : status === 'PENDING' ? 'warn' : 'bad';

/** Every attempt to reach one partner URL, with a manual resend. */
function Deliveries({ subscriptionId }: { subscriptionId: string }) {
  const { data, error, loading, reload } = useAsync(
    () => api.webhookDeliveries(subscriptionId),
    [subscriptionId],
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function resend(d: WebhookDelivery) {
    setBusy(d.id);
    try {
      const r = await api.resendDelivery(d.id);
      setMsg(
        r.status === 'DELIVERED'
          ? 'Delivered.'
          : `Not delivered: ${r.lastError ?? `HTTP ${r.lastStatusCode ?? '?'}`}. It will be retried automatically.`,
      );
      reload();
    } catch (e) {
      setMsg(staffError(e));
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) return <Skeleton lines={3} />;
  if (error) return <p role="alert">{staffError(error)}</p>;
  return (
    <>
      {msg && (
        <p role="status" className="mb-3 rounded-xl bg-slate-100 p-3 text-sm">
          {msg}
        </p>
      )}
      <DataTable
        caption="Delivery attempts"
        rows={data ?? []}
        rowKey={(d) => d.id}
        empty="Nothing sent yet. A delivery appears here when a payment changes state (run a payout in Judge Mode)."
        columns={[
          { header: 'Created', cell: (d) => when(d.createdAt) },
          {
            header: 'Event',
            cell: (d) => <span className="font-mono text-xs">{d.eventType}</span>,
          },
          {
            header: 'Status',
            cell: (d) => (
              <StatusPill tone={deliveryTone(d.status)}>{d.status.toLowerCase()}</StatusPill>
            ),
          },
          { header: 'Attempts', cell: (d) => d.attempts },
          {
            header: 'Last answer',
            cell: (d) => d.lastError ?? (d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : '—'),
          },
          { header: 'Delivered', cell: (d) => when(d.deliveredAt) },
          {
            header: 'Resend',
            cell: (d) => (
              <Button
                variant="ghost"
                className="min-h-10 text-sm"
                disabled={busy === d.id}
                onClick={() => resend(d)}
              >
                {busy === d.id ? 'Sending…' : 'Resend'}
              </Button>
            ),
          },
        ]}
      />
    </>
  );
}

/** Signed partner webhooks: register a URL, see every delivery attempt, resend by hand. */
export function AdminWebhooks() {
  const { data, error, loading, reload } = useAsync(() => api.webhooks(), []);
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [turnOff, setTurnOff] = useState<WebhookSubscription | null>(null);
  const [offBusy, setOffBusy] = useState(false);
  const [offError, setOffError] = useState<string | null>(null);
  const shownId = selected ?? data?.[0]?.id ?? null;
  const validUrl = HTTPS_URL.test(url.trim());

  async function deactivate(s: WebhookSubscription) {
    setOffBusy(true);
    setOffError(null);
    try {
      await request<WebhookSubscription>('DELETE', `/webhooks/${s.id}`);
      setTurnOff(null);
      reload();
    } catch (e) {
      setOffError(staffError(e));
    } finally {
      setOffBusy(false);
    }
  }

  async function register() {
    setMsg(null);
    try {
      const s = await api.createWebhook(url.trim());
      setUrl('');
      setSelected(s.id);
      reload();
    } catch (e) {
      setMsg(staffError(e));
    }
  }

  return (
    <Shell roles={['admin']} wide>
      <h1 className="mb-1 text-xl font-bold">Webhooks</h1>
      <p className="mb-4 text-muted">
        When a payment changes state, partners are told at once instead of polling. Each message is
        signed, retried with backoff, and logged.
      </p>
      <div className="grid gap-4 lg:grid-cols-[24rem_1fr]">
        <Card>
          <h2 className="text-lg font-bold">Register a URL</h2>
          <label className="mt-2 block text-sm">
            Partner endpoint (https)
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://partner.example/hooks/haqdaar"
              className="mt-1 min-h-12 w-full rounded-lg border-2 border-slate-400 px-2"
            />
          </label>
          <p className="mt-2 text-sm text-muted">
            Event: <code className="font-mono">payments.payment.state_changed</code>
          </p>
          <Button className="mt-3" disabled={!validUrl} onClick={register}>
            Register
          </Button>
          {msg && (
            <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-900">
              {msg}
            </p>
          )}
          <h3 className="mt-5 font-semibold">How a partner trusts it</h3>
          <p className="mt-1 text-sm text-muted">
            Every request carries{' '}
            <code className="font-mono">
              x-haqdaar-signature: t=&lt;unix&gt;,v1=&lt;hmac-sha256&gt;
            </code>{' '}
            over <code className="font-mono">t.body</code>. Failed deliveries are retried up to 6
            times with growing waits.
          </p>
        </Card>
        <div className="space-y-4">
          {loading && !data ? (
            <Skeleton lines={3} />
          ) : error ? (
            <p role="alert">{staffError(error)}</p>
          ) : (
            <DataTable
              caption="Registered webhooks"
              rows={data ?? []}
              rowKey={(s) => s.id}
              empty="No webhooks registered yet."
              columns={[
                {
                  header: 'URL',
                  cell: (s) => <span className="break-all font-mono text-xs">{s.url}</span>,
                },
                { header: 'Events', cell: (s) => s.events.join(', ') },
                {
                  header: 'State',
                  cell: (s) => (
                    <StatusPill tone={s.active ? 'ok' : 'neutral'}>
                      {s.active ? 'active' : 'off'}
                    </StatusPill>
                  ),
                },
                { header: 'Since', cell: (s) => when(s.createdAt) },
                {
                  header: 'Deliveries',
                  cell: (s) => (
                    <Button
                      variant="ghost"
                      className="min-h-10 text-sm"
                      aria-pressed={s.id === shownId}
                      onClick={() => setSelected(s.id)}
                    >
                      {s.id === shownId ? 'Showing' : 'Show'}
                    </Button>
                  ),
                },
                {
                  header: 'Turn off',
                  cell: (s) =>
                    s.active ? (
                      <Button
                        variant="ghost"
                        className="min-h-10 text-sm"
                        onClick={() => {
                          setOffError(null);
                          setTurnOff(s);
                        }}
                      >
                        Turn off…
                      </Button>
                    ) : (
                      '—'
                    ),
                },
              ]}
            />
          )}
          {shownId && (
            <section>
              <h2 className="mb-2 text-lg font-bold">Delivery attempts</h2>
              <Deliveries subscriptionId={shownId} />
            </section>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={!!turnOff}
        title="Turn off this webhook?"
        confirmLabel={offBusy ? 'Turning off…' : 'Turn off'}
        danger
        busy={offBusy}
        onClose={() => setTurnOff(null)}
        onConfirm={() => turnOff && deactivate(turnOff)}
      >
        <p className="break-all font-mono text-xs">{turnOff?.url}</p>
        <p className="text-sm">
          The partner gets no more messages, and queued retries are dropped. The delivery history
          stays here. To start again, register the URL anew.
        </p>
        {offError && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-900">
            {offError}
          </p>
        )}
      </ConfirmDialog>
    </Shell>
  );
}
