'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Shell } from '@/components/shell';
import { Button, Card, ConfirmDialog, Skeleton, StatusPill, staffError } from '@/components/ui';
import { api, request, type RaastFaultMode, type Scenario, type ScenarioResult } from '@/lib/api';
import { useAsync } from '@/lib/hooks';

interface ResetResult {
  ok: boolean;
  services: { service: string; ok: boolean; error?: string }[];
}
const resetDemo = () => request<ResetResult>('POST', '/judge/reset');

const GROUP_TITLE: Record<string, string> = { PAY: 'Bank-grade payouts' };

function Result({ r }: { r: ScenarioResult }) {
  return (
    <div className="mt-3 space-y-2" aria-live="polite">
      <p
        className={`rounded-xl border-2 p-3 font-semibold ${r.ok ? 'border-green-700 bg-green-50 text-green-900' : 'border-red-700 bg-red-50 text-red-900'}`}
      >
        {r.ok ? '✓' : '✗'} {r.summary}{' '}
        <span className="font-normal opacity-80">({(r.durationMs / 1000).toFixed(1)} s)</span>
      </p>
      <ol className="space-y-1 text-sm">
        {r.steps.map((s, i) => (
          <li key={i} className="flex gap-2 rounded-lg bg-slate-50 p-2">
            <span
              aria-label={s.ok ? 'passed' : 'failed'}
              className={s.ok ? 'text-green-800' : 'text-red-800'}
            >
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

const FAULTS: { mode: Exclude<RaastFaultMode, 'none'>; label: string; expect: string }[] = [
  {
    mode: 'fail',
    label: 'Raast is down',
    expect:
      'The rail refuses the next transfer. The payment becomes FAILED, no money moves, and a retry reuses the same transfer id.',
  },
  {
    mode: 'timeout',
    label: 'Raast times out',
    expect:
      'The rail answers too late (8 s) and moves no money. The payment becomes UNKNOWN and is not re-sent blindly: a status inquiry settles it.',
  },
  {
    mode: 'timeout_after_debit',
    label: 'Times out after taking the money',
    expect:
      'The worst case: the money moves but the answer is lost. The payment becomes UNKNOWN, a status inquiry confirms it, and it is paid once, never twice.',
  },
  {
    mode: 'duplicate_statement',
    label: 'Statement lists a payment twice',
    expect: 'The next bank statement repeats a line. Reconciliation must count it once.',
  },
];

/**
 * Lets a judge break the (mock) public payment rail live and watch the system stay safe.
 * Only Raast has a fault switch; the mock NADRA has none, its outage path is covered by the scenarios above.
 */
function BreakRail() {
  const { data, error, loading, reload } = useAsync(() => api.railFaults(), []);
  const [times, setTimes] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);
  const active = data && data.raast.mode !== 'none' ? data.raast : null;
  const activeLabel = FAULTS.find((f) => f.mode === active?.mode)?.label;

  async function set(mode: RaastFaultMode, note: string) {
    try {
      await api.setRailFault(mode, mode === 'none' ? 0 : times);
      setMsg(note);
      reload();
    } catch (e) {
      setMsg(staffError(e));
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h2 className="text-lg font-bold">Break a public rail</h2>
          <p className="text-sm text-muted">
            Make the mock Raast payment rail fail, then pay a claim (officer &gt; Payments, or a
            payout scenario below) and watch what happens.
          </p>
        </div>
        {loading && !data ? (
          <StatusPill>checking…</StatusPill>
        ) : error ? (
          <StatusPill tone="bad">{staffError(error)}</StatusPill>
        ) : active ? (
          <StatusPill tone="bad">
            BROKEN: {activeLabel ?? active.mode} · next {active.remaining} call
            {active.remaining === 1 ? '' : 's'}
          </StatusPill>
        ) : (
          <StatusPill tone="ok">Raast is healthy</StatusPill>
        )}
        <Button variant="ghost" className="min-h-10 text-sm" onClick={() => reload()}>
          Refresh
        </Button>
        <Button
          variant="ghost"
          className="min-h-10 text-sm"
          disabled={!active}
          onClick={() => set('none', 'Raast is healthy again.')}
        >
          Reset rail
        </Button>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        Break the next
        <select
          value={times}
          onChange={(e) => setTimes(Number(e.target.value))}
          className="min-h-10 rounded-lg border-2 border-slate-400 px-2"
        >
          {[1, 2, 3, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        call{times === 1 ? '' : 's'}, then heal by itself
      </label>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {FAULTS.map((f) => (
          <div
            key={f.mode}
            className={`rounded-xl border-2 p-3 ${active?.mode === f.mode ? 'border-red-700 bg-red-50' : 'border-slate-200'}`}
          >
            <Button
              variant="danger"
              className="min-h-10 w-full text-sm"
              onClick={() => set(f.mode, `Fault armed: ${f.label}. ${f.expect}`)}
            >
              {f.label}
            </Button>
            <p className="mt-2 text-sm text-muted">{f.expect}</p>
          </div>
        ))}
      </div>
      {msg && (
        <p role="status" className="mt-3 rounded-xl bg-slate-100 p-3 text-sm">
          {msg}
        </p>
      )}
      <p className="mt-3 text-sm text-muted">
        The fault state resets with &quot;Reset demo&quot;. A scenario that sets its own fault
        replaces this one.
      </p>
    </Card>
  );
}

/** One button per challenge: runs the real system end to end and shows the evidence. */
export function JudgeMode() {
  const { data, error, loading } = useAsync(() => api.scenarios(), []);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ScenarioResult | string>>({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
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
        <Link
          href="/phone"
          className="min-h-12 rounded-xl border-2 border-brand px-4 py-2.5 font-semibold text-brand-dark"
        >
          Mock phone
        </Link>
        <Button
          variant="danger"
          onClick={() => setConfirmReset(true)}
          disabled={!!running || resetting}
        >
          Reset demo…
        </Button>
      </div>
      <p className="mb-4 text-muted">
        Each button drives the real system through the public API, like a phone would, and shows
        every step. Try to break it.
      </p>
      {msg && (
        <p role="status" className="mb-3 rounded-xl bg-slate-100 p-3">
          {msg}
        </p>
      )}
      <div className="mb-6">
        <BreakRail />
      </div>
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
                        <Button
                          onClick={() => run(s)}
                          disabled={!!running}
                          aria-busy={running === s.id}
                          aria-label={`Run: ${s.title}`}
                        >
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
                          <StatusPill tone={r.ok ? 'ok' : 'bad'}>
                            {r.ok ? 'passed' : 'failed'}
                          </StatusPill>
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
        title="Reset the demo for every program?"
        confirmLabel={resetting ? 'Resetting…' : 'Reset everything'}
        danger
        busy={resetting}
        onClose={() => setConfirmReset(false)}
        onConfirm={async () => {
          setResetting(true);
          try {
            const r = await resetDemo();
            setResults({});
            const failed = r.services.filter((x) => !x.ok);
            setMsg(
              failed.length
                ? `Reset finished with problems. Not cleared: ${failed.map((x) => `${x.service} (${x.error ?? 'no answer'})`).join(', ')}.`
                : 'Fresh demo: claims, payouts and consents cleared. The audit log is never touched.',
            );
          } catch (e) {
            setMsg(staffError(e));
          } finally {
            setResetting(false);
            setConfirmReset(false);
          }
        }}
      >
        <p className="text-sm">
          Clears claims, payouts and consents in every program, not only yours, and cannot be
          undone. People, rules and the audit log stay. Platform admins only.
        </p>
      </ConfirmDialog>
    </Shell>
  );
}
