'use client';

import { useMemo, useState } from 'react';
import { Shell } from '@/components/shell';
import { Button, Card, ConfirmDialog, DataTable, Skeleton, StatusPill, staffError } from '@/components/ui';
import { api, type Lane, type RuleVersion, type Simulation } from '@/lib/api';
import { useAsync } from '@/lib/hooks';

type Path = (string | number)[];

/** Every number inside a JSON Logic expression, with its path: these are the editable thresholds. */
function numbers(node: unknown, path: Path = []): { path: Path; value: number }[] {
  if (typeof node === 'number') return [{ path, value: node }];
  if (Array.isArray(node)) return node.flatMap((n, i) => numbers(n, [...path, i]));
  if (node && typeof node === 'object') return Object.entries(node).flatMap(([k, v]) => numbers(v, [...path, k]));
  return [];
}

function setAt(node: unknown, path: Path, value: number): unknown {
  if (!path.length) return value;
  const [head, ...rest] = path;
  if (Array.isArray(node)) return node.map((n, i) => (i === head ? setAt(n, rest, value) : n));
  const o = node as Record<string, unknown>;
  return { ...o, [head!]: setAt(o[head as string], rest, value) };
}

const LANES: Lane[] = ['AUTO_APPROVE', 'ASK_MORE', 'HUMAN_REVIEW'];

function CostModel() {
  const { data, error, reload } = useAsync(() => api.costs(), []);
  const [draft, setDraft] = useState<{ wrongApproval: number; humanReview: number; askMore: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const c = draft ?? data;
  const live = c ? 1 - c.humanReview / c.wrongApproval : null;
  if (error) return <p role="alert">{staffError(error)}</p>;
  if (!c) return <Skeleton lines={2} />;
  const field = (k: 'wrongApproval' | 'humanReview' | 'askMore', label: string) => (
    <label className="block text-sm">
      {label} (PKR)
      <input
        type="number"
        min={1}
        value={c[k]}
        onChange={(e) => setDraft({ ...c, [k]: Number(e.target.value) })}
        className="mt-1 min-h-12 w-full rounded-lg border-2 border-slate-400 px-2"
      />
    </label>
  );
  return (
    <Card>
      <h2 className="text-lg font-bold">Cost of being wrong</h2>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        {field('wrongApproval', 'A wrong approval costs')}
        {field('humanReview', 'A human review costs')}
        {field('askMore', 'Asking for more info costs')}
      </div>
      <p className="mt-3" aria-live="polite">
        Auto-approve only when confidence ≥ <strong className="text-xl">{live?.toFixed(3)}</strong>
        <span className="text-muted"> = 1 − review ÷ wrong approval</span>
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Button
          disabled={!draft}
          onClick={async () => {
            try {
              await api.setCosts(draft!);
              setMsg('Saved. New decisions use this threshold now.');
              setDraft(null);
              reload();
            } catch (e) {
              setMsg(staffError(e));
            }
          }}
        >
          Save costs
        </Button>
        {msg && <span role="status">{msg}</span>}
      </div>
    </Card>
  );
}

function RuleEditor({ live, onPublished }: { live: RuleVersion; onPublished: () => void }) {
  const [clauses, setClauses] = useState(live.clauses);
  const [amount, setAmount] = useState(live.amount);
  const [sim, setSim] = useState<{ draft: RuleVersion; result: Simulation } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const changed = useMemo(() => JSON.stringify(clauses) !== JSON.stringify(live.clauses) || amount !== live.amount, [clauses, amount, live]);

  async function simulate() {
    setBusy(true);
    setMsg(null);
    try {
      const draft = await api.draftRule({ clauses, amount, notes: 'Edited in admin console' });
      setSim({ draft, result: await api.simulate(draft.id) });
    } catch (e) {
      setMsg(staffError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold">Live rule v{live.version}</h2>
          <StatusPill tone="ok">PUBLISHED</StatusPill>
        </div>
        <label className="mt-3 block text-sm">
          Monthly amount (PKR)
          <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="mt-1 min-h-12 w-40 rounded-lg border-2 border-slate-400 px-2" />
        </label>
        <ul className="mt-3 space-y-3">
          {clauses.map((cl, ci) => (
            <li key={cl.id} className="rounded-xl border border-slate-200 p-3">
              <p className="font-medium">{cl.textEn}</p>
              <p className="ur text-sm text-muted" lang="ur" dir="rtl">
                {cl.textUr}
              </p>
              <div className="mt-2 flex flex-wrap gap-3">
                {numbers(cl.logic).map((n) => (
                  <label key={n.path.join('.')} className="text-sm">
                    threshold
                    <input
                      type="number"
                      aria-label={`Threshold for: ${cl.textEn}`}
                      value={n.value}
                      onChange={(e) =>
                        setClauses((cs) => cs.map((c, i) => (i === ci ? { ...c, logic: setAt(c.logic, n.path, Number(e.target.value)) } : c)))
                      }
                      className="ml-2 min-h-12 w-28 rounded-lg border-2 border-slate-400 px-2"
                    />
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <Button disabled={!changed || busy} onClick={simulate}>
            Run Digital Twin
          </Button>
          <Button
            variant="ghost"
            disabled={!changed}
            onClick={() => {
              setClauses(live.clauses);
              setAmount(live.amount);
              setSim(null);
            }}
          >
            Undo changes
          </Button>
        </div>
        {msg && (
          <p role="status" className="mt-2">
            {msg}
          </p>
        )}
      </Card>

      {sim && (
        <Card>
          <h2 className="text-lg font-bold">Digital Twin: draft v{sim.draft.version}</h2>
          <p className="text-sm text-muted" aria-live="polite">
            Replayed {sim.result.casesReplayed} past decisions. {sim.result.changedCount} would change.
          </p>
          <DataTable
            caption="Lane counts before and after"
            rows={LANES}
            rowKey={(l) => l}
            empty=""
            columns={[
              { header: 'Lane', cell: (l) => l },
              { header: 'Live rule', cell: (l) => sim.result.before[l] },
              { header: 'Draft', cell: (l) => sim.result.after[l] },
              { header: 'Change', cell: (l) => sim.result.after[l] - sim.result.before[l] },
            ]}
          />
          {sim.result.changed.length > 0 && (
            <ul className="mt-2 text-sm">
              {sim.result.changed.slice(0, 10).map((c) => (
                <li key={c.caseId} className="font-mono">
                  {c.caseId.slice(0, 8)}: {c.from} → {c.to}
                </li>
              ))}
            </ul>
          )}
          <Button className="mt-3" onClick={() => setConfirm(true)}>
            Publish v{sim.draft.version}…
          </Button>
        </Card>
      )}

      <ConfirmDialog
        open={confirm}
        title={`Publish rule v${sim?.draft.version}?`}
        confirmLabel="Publish now"
        busy={busy}
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          if (!sim) return;
          setBusy(true);
          try {
            await api.publish(sim.draft.id);
            setMsg(`v${sim.draft.version} is live. Earlier decisions keep the version they were made with.`);
            setSim(null);
            onPublished();
          } catch (e) {
            setMsg(staffError(e));
          } finally {
            setBusy(false);
            setConfirm(false);
          }
        }}
      >
        <p className="text-sm">New claims are decided with it immediately. {sim?.result.changedCount} recent decisions would have changed.</p>
      </ConfirmDialog>
    </div>
  );
}

export function AdminRules() {
  const { data, error, loading, reload } = useAsync(() => api.rules(), []);
  const live = data?.find((r) => r.status === 'PUBLISHED');
  return (
    <Shell roles={['admin']} wide>
      <h1 className="mb-4 text-xl font-bold">Rules and costs</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>{loading && !data ? <Skeleton lines={6} /> : error ? <p role="alert">{staffError(error)}</p> : live ? <RuleEditor key={live.id} live={live} onPublished={reload} /> : <p>No published rule.</p>}</div>
        <CostModel />
      </div>
    </Shell>
  );
}
