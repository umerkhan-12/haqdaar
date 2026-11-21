import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COSTS } from '@haqdaar/shared';
import { PLATT, sigmoid } from '../engine/calibration';
import { confidenceScore, type Evidence } from '../engine/decide';
import { fitPlatt, reliabilityTable } from './calibration';
import { ARCHETYPES, generateDataset, prng } from './dataset';
import { runEvaluation, wilsonUpper } from './evaluate';
import { GATES } from './check';

const perfect: Evidence = {
  nadraMatch: true,
  nameScore: 1,
  householdVerified: true,
  extractionConfidence: null,
  possibleDuplicate: false,
};

test('dataset is deterministic per seed, with the documented mix and a 40% held-out split', () => {
  const a = generateDataset(2026, 500);
  assert.deepEqual(a, generateDataset(2026, 500));
  assert.notDeepEqual(a, generateDataset(2027, 500));
  for (const [arch, share] of ARCHETYPES) {
    const rows = a.filter((c) => c.archetype === arch);
    assert.equal(rows.length, Math.round(share * 500), arch);
    assert.equal(
      rows.filter((c) => c.split === 'test').length,
      Math.round(rows.length * 0.4),
      arch,
    );
  }
  assert.ok(
    a
      .filter((c) => c.archetype.startsWith('fraud') || c.archetype === 'ineligible')
      .every((c) => !c.payable),
  );
});

test('Platt fit recovers known parameters', () => {
  const r = prng(1);
  const xs = Array.from({ length: 4000 }, () => r.uniform(-4, 4));
  const ys = xs.map((x) => r.next() < sigmoid(1.5 * x - 0.5));
  const { a, b } = fitPlatt(xs, ys);
  assert.ok(Math.abs(a - 1.5) < 0.15, `a=${a}`);
  assert.ok(Math.abs(b + 0.5) < 0.15, `b=${b}`);
});

test('reliability table has 10 bins covering every case', () => {
  const r = prng(2);
  const ps = Array.from({ length: 123 }, () => r.next());
  const bins = reliabilityTable(
    ps,
    ps.map((p) => r.next() < p),
  );
  assert.equal(bins.length, 10);
  assert.equal(
    bins.reduce((s, b) => s + b.n, 0),
    123,
  );
});

test("engine's stored Platt parameters are what the canonical training split gives", () => {
  const report = runEvaluation({ costs: DEFAULT_COSTS, amountCap: 15_000 });
  assert.equal(
    report.calibration.storedMatchesFit,
    true,
    JSON.stringify(report.calibration.fitted),
  );
  assert.equal(report.calibration.engineUses, 'calibrated');
});

test('calibrated: perfect typed evidence clears 0.988, weaker evidence does not', () => {
  assert.ok(confidenceScore(perfect) >= 0.99);
  assert.ok(confidenceScore({ ...perfect, nameScore: 0.9 }) < 0.988); // relative-impersonation band
  assert.ok(confidenceScore({ ...perfect, extractionConfidence: 0.6 }) < 0.988); // unsure voice extraction
  assert.ok(confidenceScore({ ...perfect, possibleDuplicate: true }) < 0.5);
  assert.ok(confidenceScore(perfect, null) > confidenceScore({ ...perfect, nameScore: 0.9 }, null));
  assert.deepEqual(PLATT, { a: 5.444271304, b: -26.87709434 });
});

test('golden-set gates pass and the expected-cost minimum contains the cost-model threshold', () => {
  const report = runEvaluation({ costs: DEFAULT_COSTS, amountCap: 15_000 });
  for (const g of GATES) assert.ok(g.ok(report), `${g.name}: ${g.value(report)}`);
  const m = report.costCurve.expectedMinimum;
  assert.ok(m.from <= 0.988 && 0.988 <= m.to, JSON.stringify(m));
  // the raw score lets relatives with similar names through: calibration is what keeps fraud out
  assert.ok(report.rawBaseline.wrongAutoApprovals.count > report.metrics.wrongAutoApprovals.count);
});

test('changing costs moves the threshold the evaluation uses', () => {
  const r = runEvaluation({ costs: { ...DEFAULT_COSTS, humanReview: 1000 }, amountCap: 15_000 });
  assert.equal(r.costs.threshold, 0.96);
  assert.ok(r.costCurve.points.some((p) => p.threshold === 0.96));
});

test('Wilson upper bound is above the observed rate and shrinks with n', () => {
  assert.ok(wilsonUpper(0, 65) > 0.05);
  assert.ok(wilsonUpper(0, 1000) < 0.005);
  assert.ok(wilsonUpper(5, 100) > 0.05);
});
