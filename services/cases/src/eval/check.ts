/**
 * Golden-set check for CI: `pnpm --filter @haqdaar/cases eval:check`.
 * Runs the offline evaluation on the canonical synthetic set (seed 2026, 500 cases, held-out split) at the default
 * costs and exits 1 if a gate fails. A larger fresh sample is printed for context but does not gate.
 */
import { DEFAULT_COSTS } from '@haqdaar/shared';
import { runEvaluation, type EvalReport } from './evaluate';

const AMOUNT_CAP = 15_000;

export const GATES: {
  name: string;
  ok: (r: EvalReport) => boolean;
  value: (r: EvalReport) => string;
}[] = [
  {
    name: 'wrong auto-approvals ≤ 0.5% of auto-approved',
    ok: (r) => r.metrics.wrongAutoApprovals.rate <= 0.005,
    value: (r) =>
      `${r.metrics.wrongAutoApprovals.count}/${r.metrics.lanes.autoApprove} = ${pct(r.metrics.wrongAutoApprovals.rate)}`,
  },
  {
    name: 'routing accuracy ≥ 65%',
    ok: (r) => r.metrics.routingAccuracy >= 0.65,
    value: (r) => pct(r.metrics.routingAccuracy),
  },
  {
    name: 'automation of payable claims ≥ 45%',
    ok: (r) => r.metrics.automationOfPayable >= 0.45,
    value: (r) => pct(r.metrics.automationOfPayable),
  },
  {
    name: 'cost per case below "an officer checks everything"',
    ok: (r) => r.metrics.cost.perCase < r.metrics.cost.allHumanPerCase,
    value: (r) => `${r.metrics.cost.perCase} vs ${r.metrics.cost.allHumanPerCase}`,
  },
  {
    name: 'calibration error (ECE) ≤ 0.06',
    ok: (r) => r.calibration.calibrated.ece <= 0.06,
    value: (r) => r.calibration.calibrated.ece.toFixed(4),
  },
  {
    name: "engine's stored Platt parameters match a refit",
    ok: (r) => r.calibration.storedMatchesFit,
    value: (r) => `stored ${fmtAB(r.calibration.stored)}, refit ${fmtAB(r.calibration.fitted)}`,
  },
];

function pct(x: number | null) {
  return x === null ? 'n/a' : `${(x * 100).toFixed(2)}%`;
}
function fmtAB(p: { a: number; b: number }) {
  return `a=${p.a.toFixed(4)} b=${p.b.toFixed(4)}`;
}

function main() {
  const report = runEvaluation({ costs: DEFAULT_COSTS, amountCap: AMOUNT_CAP });
  const h = report.headline;
  console.log(
    `Golden set: seed ${h.datasetSeed}, ${h.datasetSize} synthetic cases, ${h.testCases} held out, threshold ${h.threshold}`,
  );
  let failed = 0;
  for (const g of GATES) {
    const ok = g.ok(report);
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${g.name}: ${g.value(report)}`);
  }
  const raw = report.rawBaseline;
  console.log(
    `info  raw (uncalibrated) engine on the same cases: ${raw.wrongAutoApprovals.count} wrong auto-approvals ` +
      `(${pct(raw.wrongAutoApprovals.rate)}), cost/case ${raw.cost.perCase}`,
  );
  const fresh = runEvaluation({
    seed: 99,
    size: 5000,
    costs: DEFAULT_COSTS,
    amountCap: AMOUNT_CAP,
  });
  const fw = fresh.metrics.wrongAutoApprovals;
  console.log(
    `info  fresh sample (seed 99, ${fresh.headline.testCases} held out): wrong ${fw.count}/${fresh.metrics.lanes.autoApprove} = ${pct(fw.rate)} ` +
      `(95% upper ${pct(fw.upper95)}), automation ${pct(fresh.metrics.automationRate)}, cost/case ${fresh.metrics.cost.perCase}`,
  );
  if (failed) {
    console.error(`${failed} gate(s) failed`);
    process.exit(1);
  }
  console.log('All gates passed');
}

if (require.main === module) main();
