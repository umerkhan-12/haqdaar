'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Shell } from '@/components/shell';
import { Button, Card, ConfirmDialog, Skeleton, StatusPill, staffError } from '@/components/ui';
import { api, type Scenario, type ScenarioResult } from '@/lib/api';
import { useAsync } from '@/lib/hooks';

const GROUP_TITLE: Record<string, string> = { PAY: 'Bank-grade payouts' };

function Result({ r }: { r: ScenarioResult }) {
  return (
    <div className="mt-3 space-y-2" aria-live="polite">
      <p className={`rounded-xl border-2 p-3 font-semibold ${r.ok ? 'border-green-700 bg-green-50 text-green-900' : 'border-red-700 bg-red-50 text-red-900'}`}>
        {r.ok ? '✓' : '✗'} {r.summary} <span className="font-normal opacity-80">({(r.durationMs / 1000).toFixed(1)} s)</span>
      </p>
      <ol className="space-y-1 text-sm">
        {r.steps.map((s, i) => (
          <li key={i} className="flex gap-2 rounded-lg bg-slate-50 p-2">
            <span aria-label={s.ok ? 'passed' : 'failed'} className={s.ok ? 'text-green-800' : 'text-red-800'}>
              {s.ok ? '✓' : '✗'}
            </span>
            <span className="flex-1">
              <span className="font-medium">{s.label}</span>
              {s.detail && <span className="block text-muted">{s.detail}</span>}
            </span>
            {s.ms > 0 && <span className="text-xs text-muted">{s.ms} ms</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** One button per challenge: runs the real system end to end and shows the evidence. */
export function JudgeMode() {
  const { data, error, loading } = useAsync(() => api.scenarios(), []);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ScenarioResult | string>>({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(s: Scenario) {
    setRunning(s.id);
    try {
      const r = await api.runScenario(s.id);
      setResults((x) => ({ ...x, [s.id]: r }));
    } catch (e) {
      setResults((x) => ({ ...x, [s.id]: staffError(e) }));
    } finally {
      setRunning(null);
    }
  }

  const groups = (data ?? []).reduce<Record<string, Scenario[]>>((g, s) => {
    (g[s.challenge] ??= []).push(s);
    return g;
  }, {});

  return (
    <Shell roles={['admin']} wide>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">Judge Mode</h1>
        <Link href="/phone" className="min-h-12 rounded-xl border-2 border-brand px-4 py-2.5 font-semibold text-brand-dark">
          Mock phone
        </Link>
        <Button variant="ghost" onClick={() => setConfirmReset(true)} disabled={!!running}>
          Reset demo…
        </Button>
      </div>
      <p className="mb-4 text-muted">Each button drives the real system through the public API, like a phone would, and shows every step. Try to break it.</p>
      {msg && (
        <p role="status" className="mb-3 rounded-xl bg-slate-100 p-3">
          {msg}
        </p>
      )}
      {loading && !data ? (
        <Skeleton lines={6} />
      ) : error ? (
        <p role="alert">{staffError(error)}</p>
      ) : (
        <div className="space-y-6">
          {Object.entries(groups).map(([challenge, list]) => (
            <section key={challenge} aria-labelledby={`g-${challenge}`}>
              <h2 id={`g-${challenge}`} className="mb-2 text-lg font-bold">
                {GROUP_TITLE[challenge] ?? `Challenge ${challenge}`}
              </h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {list.map((s) => {
                  const r = results[s.id];
                  return (
                    <Card key={s.id}>
                      <div className="flex items-start gap-3">
                        <div className="flex-1">
                          <h3 className="font-semibold">{s.title}</h3>
                          <p className="text-sm text-muted">{s.proves}</p>
                        </div>
                        <Button onClick={() => run(s)} disabled={!!running} aria-busy={running === s.id} aria-label={`Run: ${s.title}`}>
                          {running === s.id ? 'Running…' : 'Run'}
                        </Button>
                      </div>
                      {running === s.id && <Skeleton lines={2} />}
                      {typeof r === 'string' && (
                        <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-red-900">
                          {r}
                        </p>
                      )}
                      {r && typeof r !== 'string' && <Result r={r} />}
                      {r && typeof r !== 'string' && (
                        <p className="mt-2">
                          <StatusPill tone={r.ok ? 'ok' : 'bad'}>{r.ok ? 'passed' : 'failed'}</StatusPill>
                        </p>
                      )}
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={confirmReset}
        title="Reset the demo?"
        confirmLabel="Reset"
        onClose={() => setConfirmReset(false)}
        onConfirm={async () => {
          setConfirmReset(false);
          try {
            const r = await api.resetDemo();
            setResults({});
            setMsg(r.ok ? 'Fresh demo: claims, payouts and consents cleared. The audit log is never touched.' : 'Reset finished with problems — check service status.');
          } catch (e) {
            setMsg(staffError(e));
          }
        }}
      >
        <p className="text-sm">Clears claims, payouts and consents. People, rules and the audit log stay.</p>
      </ConfirmDialog>
    </Shell>
  );
}
