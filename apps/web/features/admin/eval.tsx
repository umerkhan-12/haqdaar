'use client';

import { useState, type ReactNode } from 'react';
import { Shell } from '@/components/shell';
import {
  Button,
  Card,
  DataTable,
  Skeleton,
  StatusPill,
  staffError,
  type Tone,
} from '@/components/ui';
import { api, type AiQuality, type EvalMetrics, type EvalRun, type EvalSummary } from '@/lib/api';
import { useAsync, useSession } from '@/lib/hooks';

const pct = (n: number | null | undefined, digits = 1) =>
  n == null ? '—' : `${(n * 100).toFixed(digits)}%`;
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-PK')}`;
const num = (n: number | null | undefined, unit: string) =>
  n == null ? '—' : `${n.toLocaleString('en-PK')} ${unit}`;
const when = (iso: string) => new Date(iso).toLocaleString('en-PK');

const BAR: Record<Tone, string> = {
  ok: 'bg-green-700',
  bad: 'bg-red-700',
  warn: 'bg-amber-600',
  info: 'bg-brand',
  neutral: 'bg-slate-500',
};

const REASON_LABEL: Record<string, string> = {
  low_confidence: 'Confidence below the threshold',
  ask_more: 'Asked for more information',
  'flag:household_not_found': 'Household record not found',
  'flag:verification_unavailable': 'Identity check unavailable',
};

interface BarRow {
  label: string;
  value: number;
  tone?: Tone;
  suffix?: string;
}

/** One headline number. The dot repeats the meaning of the text, it never carries it alone. */
function Tile({
  label,
  value,
  note,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  note?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="flex items-center gap-2 text-sm text-muted">
        <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${BAR[tone]}`} />
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {note && <p className="mt-1 text-sm text-muted">{note}</p>}
    </div>
  );
}

/** Plain CSS bar chart: one row per item with the value printed, so it reads without colour. */
function Bars({ rows, caption }: { caption: string; rows: BarRow[] }) {
  if (!rows.length) return <p className="text-sm text-muted">Nothing to show yet.</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul aria-label={caption} className="space-y-2">
      {rows.map((r) => (
        <li
          key={r.label}
          className="grid grid-cols-[minmax(6rem,13rem)_1fr_auto] items-center gap-3 text-sm"
        >
          <span className="truncate" title={r.label}>
            {r.label}
          </span>
          <span className="h-3 rounded-full bg-slate-100">
            <span
              className={`block h-3 rounded-full ${BAR[r.tone ?? 'info']}`}
              style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value ? 4 : 0 }}
            />
          </span>
          <span className="min-w-16 text-right font-semibold tabular-nums">
            {r.value.toLocaleString('en-PK')}
            {r.suffix ?? ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold">{title}</h2>
      {note && <p className="text-sm text-muted">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

const laneRows = (auto: number, ask: number, human: number): BarRow[] => [
  { label: 'Paid automatically', value: auto, tone: 'ok' },
  { label: 'Asked for more information', value: ask, tone: 'warn' },
  { label: 'Sent to an officer', value: human, tone: 'info' },
];

/** Headline tiles from the latest run: accuracy, false alarms, wrong approvals, cost, calibration, threshold. */
function EvalTiles({ run }: { run: EvalRun }) {
  const h = run.headline;
  const m: EvalMetrics = run.metrics;
  const raw = run.rawBaseline;
  const saved = 1 - h.costPerCase / h.costPerCaseAllHuman;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Wrong auto-approvals"
          value={`${m.wrongAutoApprovals.count} of ${m.lanes.autoApprove}`}
          tone={m.wrongAutoApprovals.count === 0 ? 'ok' : 'bad'}
          note={`Money sent to someone not entitled. With a sample this small the true rate could still be up to ${pct(m.wrongAutoApprovals.upper95)} (95% bound).`}
        />
        <Tile
          label="False alarms"
          value={`${m.falseAlarms.count} people`}
          tone="warn"
          note={`${pct(m.falseAlarms.rateOfPayable)} of genuinely entitled people were sent to an officer or asked for more instead of being paid at once. The machine refused nobody.`}
        />
        <Tile
          label="Routing accuracy"
          value={pct(h.routingAccuracy)}
          tone="info"
          note={`Claims that went to the right lane. When the system decides alone it is right ${pct(h.accuracyOnDecided)} of the time.`}
        />
        <Tile
          label="Fraud and ineligible caught"
          value={`${m.fraudCaught.caught} of ${m.fraudCaught.of}`}
          tone={m.fraudCaught.recall === 1 ? 'ok' : 'bad'}
          note="Not-payable claims that never reached automatic payment."
        />
        <Tile
          label="Cost per case"
          value={rs(h.costPerCase)}
          tone={saved > 0 ? 'ok' : 'warn'}
          note={`All-human baseline: ${rs(h.costPerCaseAllHuman)}. ${saved > 0 ? `${pct(saved, 0)} cheaper` : `${pct(-saved, 0)} dearer`}, counting the cost of every mistake.`}
        />
        <Tile
          label="Handled without an officer"
          value={pct(h.automationRate)}
          tone="info"
          note={`${m.lanes.autoApprove} of ${m.cases} test claims were paid automatically.`}
        />
        <Tile
          label="Calibration error (ECE)"
          value={pct(h.calibratedEce)}
          tone={h.calibratedEce <= 0.05 ? 'ok' : 'warn'}
          note={`How far "I am 95% sure" is from the truth, on average. Before calibration: ${pct(h.rawEce)}.`}
        />
        <Tile
          label="Auto-approve threshold"
          value={pct(h.threshold)}
          note={`Worked out from costs: wrong approval ${rs(run.costs.wrongApproval)}, officer review ${rs(run.costs.humanReview)}, asking more ${rs(run.costs.askMore)}. Never automatic above ${rs(run.costs.amountCap)}.`}
        />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold">Where the {m.cases} test claims went</h3>
          <Bars
            caption="Evaluation lanes"
            rows={laneRows(m.lanes.autoApprove, m.lanes.askMore, m.lanes.humanReview)}
          />
          <p className="mt-3 text-sm text-muted">
            The same engine without calibration would auto-pay {raw.lanes.autoApprove} claims and
            get {raw.wrongAutoApprovals.count} wrong ({rs(raw.cost.perCase)} per case).
          </p>
        </Card>
        <Card>
          <h3 className="mb-3 font-semibold">Why entitled people were not paid at once</h3>
          <Bars
            caption="False alarms by reason"
            rows={Object.entries(m.falseAlarms.byReason)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => ({ label: REASON_LABEL[k] ?? k, value: v, tone: 'warn' }))}
          />
          <p className="mt-3 text-sm text-muted">
            A false alarm costs an officer&apos;s time, not the person&apos;s entitlement: an
            officer still decides.
          </p>
        </Card>
      </div>
      <Card className="mt-4">
        <h3 className="font-semibold">Is the confidence honest?</h3>
        <p className="mb-3 text-sm text-muted">
          {run.calibration.method}. Each row is a group of test claims: what the system predicted
          against what was true.
        </p>
        <DataTable
          caption="Reliability table"
          rows={run.calibration.reliability}
          rowKey={(b) => String(b.bin)}
          empty="No calibration data."
          columns={[
            { header: 'Group', cell: (b) => b.bin },
            { header: 'Claims', cell: (b) => b.n },
            { header: 'Predicted payable', cell: (b) => pct(b.predicted) },
            { header: 'Actually payable', cell: (b) => pct(b.observed) },
            {
              header: 'Gap',
              cell: (b) => {
                const gap = Math.abs(b.predicted - b.observed);
                return (
                  <StatusPill tone={gap <= 0.05 ? 'ok' : gap <= 0.15 ? 'warn' : 'bad'}>
                    {pct(gap)}
                  </StatusPill>
                );
              },
            },
          ]}
        />
      </Card>
    </>
  );
}

/** Live counts from this program's own claims: lanes, statuses, queue age, time to pay. */
function LivePanel({ s }: { s: EvalSummary }) {
  const w = s.queue.waitingMinutes;
  const t = s.timeToMoney;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Claims so far"
          value={String(s.claims.total)}
          note={`${s.lanes.decided} decided · ${pct(s.lanes.automationRate)} paid without an officer`}
        />
        <Tile
          label="Waiting in the queue"
          value={String(s.queue.size)}
          tone={s.queue.size ? 'warn' : 'ok'}
          note={`${s.queue.inReview} with an officer · ${s.queue.needsInfo} waiting for the citizen`}
        />
        <Tile
          label="Queue age (median)"
          value={num(w.median, 'min')}
          tone="info"
          note={`9 in 10 wait under ${num(w.p90, 'min')}; the longest has waited ${num(w.max, 'min')}.`}
        />
        <Tile
          label="Time to money (median)"
          value={num(t.medianSeconds, 's')}
          tone="ok"
          note={`${t.paidCases} paid claims, p90 ${num(t.p90Seconds, 's')}. Automatic ${num(t.medianSecondsAutoApproved, 's')} · officer-approved ${num(t.medianSecondsOfficerApproved, 's')}.`}
        />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold">Lanes</h3>
          <Bars
            caption="Live lane counts"
            rows={laneRows(s.lanes.AUTO_APPROVE, s.lanes.ASK_MORE, s.lanes.HUMAN_REVIEW)}
          />
        </Card>
        <Card>
          <h3 className="mb-3 font-semibold">Claim status</h3>
          <Bars
            caption="Live status counts"
            rows={Object.entries(s.claims.byStatus)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => ({
                label: k.replace('_', ' ').toLowerCase(),
                value: v,
                tone: k === 'REJECTED' ? 'bad' : k === 'PAID' ? 'ok' : 'neutral',
              }))}
          />
        </Card>
      </div>
      <p className="mt-2 text-sm text-muted">
        Time to money = {t.definition}. Payments here go to a mock rail, so a real bank will be
        slower.
      </p>
    </>
  );
}

/** AI reliability and speed since the AI service last started. */
function AiPanel({ ai }: { ai: AiQuality }) {
  const st = ai.stats;
  const providers: BarRow[] = Object.entries(st.byProvider ?? {}).map(([provider, p]) => ({
    label: `${provider} (${p.calls} calls)`,
    value: p.calls ? Math.round(p.totalMs / p.calls) : 0,
    suffix: ' ms',
    tone: provider === 'mock' ? 'neutral' : 'info',
  }));
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <div className="grid gap-3 sm:grid-cols-2">
        <Tile
          label="AI calls"
          value={String(st.calls)}
          note={`Profile: ${ai.profile}${ai.killed ? ' · AI is switched OFF' : ''}`}
        />
        <Tile
          label="Provider failures"
          value={String(st.failures)}
          tone={st.failures ? 'warn' : 'ok'}
          note={st.calls ? `${pct(st.failures / st.calls)} of calls` : 'No calls yet'}
        />
        <Tile
          label="Fallbacks used"
          value={String(st.fallbacks)}
          tone="info"
          note="A second provider answered when the first could not."
        />
        <Tile
          label="Safe local answers"
          value={String(st.mockAnswers)}
          tone={st.mockAnswers ? 'warn' : 'ok'}
          note="No model answered, so the claim went to a person."
        />
      </div>
      <Card>
        <h3 className="mb-3 font-semibold">Average answer time by provider</h3>
        <Bars caption="Average latency per provider" rows={providers} />
        <p className="mt-3 text-sm text-muted">
          Counters restart with the AI service. A failure never becomes an approval: next comes
          another provider, then a person.
        </p>
      </Card>
    </div>
  );
}

/**
 * One page for "accuracy, false alarms, speed, cost, failures": the offline evaluation on synthetic labelled
 * claims, live queue and payout numbers, and AI call quality. Auditors read; only admins start a run.
 */
export function AdminEval() {
  const session = useSession();
  const summary = useAsync(() => api.evalSummary(), []);
  const runs = useAsync(() => api.evalRuns(), []);
  const ai = useAsync(() => api.aiQuality(), []);
  const latestId = runs.data?.[0]?.id;
  const latest = useAsync(
    () => (latestId ? api.evalRun(latestId) : Promise.resolve(null)),
    [latestId],
  );
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const isAdmin = session?.role === 'admin';

  async function run() {
    setRunning(true);
    setMsg(null);
    try {
      const r = await api.runEval();
      setMsg(
        `Evaluation finished on ${r.headline.testCases} held-out synthetic claims: ${r.headline.wrongAutoApprovals} wrong auto-approvals, ${r.headline.falseAlarms} false alarms.`,
      );
      runs.reload();
      summary.reload();
      ai.reload();
    } catch (e) {
      setMsg(staffError(e));
    } finally {
      setRunning(false);
    }
  }

  const h = latest.data?.headline;
  return (
    <Shell roles={['admin', 'auditor']} wide>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-bold">Evaluation</h1>
        {isAdmin && (
          <Button onClick={run} disabled={running} aria-busy={running}>
            {running ? 'Running…' : 'Run evaluation now'}
          </Button>
        )}
      </div>
      <p className="mb-4 rounded-xl border-2 border-amber-700 bg-amber-50 p-3 text-sm text-amber-900">
        <strong>Read this first.</strong> The accuracy numbers come from synthetic, labelled test
        claims generated by this prototype
        {h
          ? ` (${h.datasetSize} claims, seed ${h.datasetSeed}, ${h.testCases} held out for testing)`
          : ''}
        , not from real people. They show how the decision engine behaves; they do not prove how it
        would perform in a real programme. The live numbers further down count this demo&apos;s own
        claims.
      </p>
      {msg && (
        <p role="status" className="mb-3 rounded-xl bg-slate-100 p-3">
          {msg}
        </p>
      )}

      {(runs.loading && !runs.data) || (latest.loading && !latest.data) ? (
        <Skeleton lines={6} />
      ) : runs.error || latest.error ? (
        <p role="alert">{staffError(runs.error ?? latest.error)}</p>
      ) : latest.data ? (
        <>
          <p className="mb-3 text-sm text-muted">Latest run: {when(latest.data.createdAt)}</p>
          <EvalTiles run={latest.data} />
        </>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-300 p-4 text-muted">
          No evaluation has been run for this program yet.{' '}
          {isAdmin ? 'Press "Run evaluation now".' : 'An admin can start one.'}
        </p>
      )}

      <Section
        title="Live: this program's claims"
        note="Counted from the claims in this demo right now."
      >
        {summary.loading && !summary.data ? (
          <Skeleton lines={3} />
        ) : summary.error ? (
          <p role="alert">{staffError(summary.error)}</p>
        ) : summary.data ? (
          <LivePanel s={summary.data} />
        ) : null}
      </Section>

      <Section
        title="AI call quality"
        note="Failures, fallbacks and speed of the speech and language models."
      >
        {ai.loading && !ai.data ? (
          <Skeleton lines={3} />
        ) : ai.error ? (
          <p role="alert">{staffError(ai.error)}</p>
        ) : ai.data ? (
          <AiPanel ai={ai.data} />
        ) : null}
      </Section>

      <Section title="Past runs">
        <DataTable
          caption="Past evaluation runs"
          rows={runs.data ?? []}
          rowKey={(r) => r.id}
          empty="No runs yet."
          columns={[
            { header: 'When', cell: (r) => when(r.createdAt) },
            { header: 'Test claims', cell: (r) => `${r.headline.testCases} of ${r.datasetSize}` },
            { header: 'Threshold', cell: (r) => pct(r.headline.threshold) },
            {
              header: 'Wrong approvals',
              cell: (r) => (
                <StatusPill tone={r.headline.wrongAutoApprovals ? 'bad' : 'ok'}>
                  {r.headline.wrongAutoApprovals}
                </StatusPill>
              ),
            },
            { header: 'False alarms', cell: (r) => r.headline.falseAlarms },
            { header: 'Routing accuracy', cell: (r) => pct(r.headline.routingAccuracy) },
            { header: 'Automated', cell: (r) => pct(r.headline.automationRate) },
            {
              header: 'Cost / case',
              cell: (r) => `${rs(r.headline.costPerCase)} vs ${rs(r.headline.costPerCaseAllHuman)}`,
            },
            { header: 'ECE', cell: (r) => pct(r.headline.calibratedEce) },
          ]}
        />
      </Section>
    </Shell>
  );
}
