'use client';

import { useState } from 'react';
import { Shell } from '@/components/shell';
import { Button, Card, ConfirmDialog, DataTable, Skeleton, StatusPill, staffError } from '@/components/ui';
import { api, type AiStatus } from '@/lib/api';
import { useAsync } from '@/lib/hooks';

const PROFILES: { id: AiStatus['profile']; label: string; note: string }[] = [
  { id: 'dev', label: 'Build (dev)', note: 'Free Groq first, free Gemini fallback' },
  { id: 'demo', label: 'Judging (demo)', note: 'Paid Gemini first — judging day only' },
  { id: 'offline', label: 'Offline', note: 'No external AI; uncertain cases go to people' },
];

function Chain({ title, rows }: { title: string; rows: AiStatus['llm'] }) {
  return (
    <div>
      <h3 className="mb-1 font-semibold">{title}</h3>
      <DataTable
        caption={title}
        rows={rows}
        rowKey={(r) => r.provider}
        empty="No providers"
        columns={[
          { header: 'Order', cell: (r) => rows.indexOf(r) + 1 },
          { header: 'Provider', cell: (r) => r.provider },
          { header: 'Key', cell: (r) => <StatusPill tone={r.configured ? 'ok' : 'warn'}>{r.configured ? 'set' : 'missing'}</StatusPill> },
          { header: 'Circuit', cell: (r) => <StatusPill tone={r.circuit === 'CLOSED' ? 'ok' : 'bad'}>{r.circuit}</StatusPill> },
        ]}
      />
    </div>
  );
}

export function AdminAi() {
  const { data, error, loading, reload } = useAsync(() => api.aiStatus(), []);
  const [confirmKill, setConfirmKill] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      setMsg(ok);
      reload();
    } catch (e) {
      setMsg(staffError(e));
    }
  }

  return (
    <Shell roles={['admin']} wide>
      <h1 className="mb-4 text-xl font-bold">AI controls</h1>
      {msg && (
        <p role="status" className="mb-3 rounded-xl bg-slate-100 p-3">
          {msg}
        </p>
      )}
      {loading && !data ? (
        <Skeleton lines={5} />
      ) : error ? (
        <p role="alert">{staffError(error)}</p>
      ) : data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="text-lg font-bold">Kill AI</h2>
            <p className="mt-1 text-sm text-muted">Switches every AI model off. The system keeps working: uncertain answers go to officers, rules still catch scams.</p>
            <div className="mt-3 flex items-center gap-3">
              <StatusPill tone={data.killed ? 'bad' : 'ok'}>{data.killed ? 'AI is OFF' : 'AI is ON'}</StatusPill>
              {data.killed ? (
                <Button onClick={() => act(() => api.setKill(false), 'AI is back on.')}>Turn AI on</Button>
              ) : (
                <Button variant="danger" onClick={() => setConfirmKill(true)}>
                  Kill AI…
                </Button>
              )}
            </div>
            <h2 className="mt-6 text-lg font-bold">Profile</h2>
            <fieldset className="mt-2 space-y-2">
              <legend className="sr-only">AI profile</legend>
              {PROFILES.map((p) => (
                <label key={p.id} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border-2 p-3 ${data.profile === p.id ? 'border-brand bg-brand-soft' : 'border-slate-200'}`}>
                  <input type="radio" name="profile" checked={data.profile === p.id} onChange={() => act(() => api.setProfile(p.id), `Profile set to ${p.label}.`)} className="h-5 w-5" />
                  <span>
                    <span className="font-semibold">{p.label}</span>
                    <span className="block text-sm text-muted">{p.note}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="mt-3 text-sm">
              Calls {data.stats.calls} · fallbacks {data.stats.fallbacks} · failures {data.stats.failures} · mock answers {data.stats.mockAnswers}
            </p>
          </Card>
          <Card className="space-y-4">
            <Chain title="Text (LLM) chain" rows={data.llm} />
            <Chain title="Urdu speech chain" rows={data.stt} />
            <p className="text-sm text-muted">Last resort is always a deterministic local answer that routes to a person.</p>
          </Card>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmKill}
        title="Switch every AI model off?"
        confirmLabel="Kill AI"
        danger
        onClose={() => setConfirmKill(false)}
        onConfirm={() => {
          setConfirmKill(false);
          void act(() => api.setKill(true), 'AI is off. Watch claims still flow — to people.');
        }}
      />
    </Shell>
  );
}
