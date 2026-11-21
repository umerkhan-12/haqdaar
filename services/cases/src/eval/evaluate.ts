import { autoApproveThreshold, type CostSettings, type Lane } from '@haqdaar/shared';
import { ACTIVE_CALIBRATION, PLATT, sigmoid, type PlattParams } from '../engine/calibration';
import { decide, rawEvidenceLogit, type DecisionOutcome } from '../engine/decide';
import { SAHARA_V1, type Clause } from '../engine/rules';
import { calibrationScores, fitPlatt, reliabilityTable, round } from './calibration';
import {
  ARCHETYPES,
  DEFAULT_SEED,
  DEFAULT_SIZE,
  generateDataset,
  type Archetype,
  type LabelledCase,
} from './dataset';

export interface EvalOptions {
  seed?: number;
  size?: number;
  costs: CostSettings;
  amountCap: number;
  clauses?: Clause[];
  amount?: number;
}

/** Thresholds for the cost curve: coarse up to 0.98, then every 0.001. */
export const CURVE_THRESHOLDS = [
  ...Array.from({ length: 9 }, (_, i) => 0.9 + i * 0.01),
  ...Array.from({ length: 20 }, (_, i) => 0.98 + i * 0.001),
].map((t) => round(t, 3));

interface Scored {
  c: LabelledCase;
  /** As the engine decides today (with the calibration it uses) */
  outcome: DecisionOutcome;
  /** The same claim scored with the raw, uncalibrated evidence score */
  rawOutcome: DecisionOutcome;
  /** Reached the confidence gate: verified, eligible by rule, no hard flag, amount within the cap */
  candidate: boolean;
  /** Candidate the calibration is fitted on: also no near-duplicate identity, which always goes to a human */
  calibrationPopulation: boolean;
  rawLogit: number;
}

/**
 * Offline evaluation on the synthetic labelled set.
 * Calibration is fitted on the train split; every reported number is on the held-out test split.
 * The engine's lanes come from `decide` itself with the calibration it actually uses.
 */
export function runEvaluation(o: EvalOptions) {
  const seed = o.seed ?? DEFAULT_SEED;
  const size = o.size ?? DEFAULT_SIZE;
  const clauses = o.clauses ?? SAHARA_V1.clauses;
  const amount = o.amount ?? SAHARA_V1.amount;
  const threshold = autoApproveThreshold(o.costs);
  const ctx = { clauses, amount, costs: o.costs, amountCap: o.amountCap };

  const scored: Scored[] = generateDataset(seed, size).map((c) => {
    const outcome = decide(c.inputs, ctx);
    const rawOutcome = decide(c.inputs, { ...ctx, calibration: null });
    const candidate =
      outcome.lane !== 'ASK_MORE' &&
      !outcome.hardFlags.length &&
      outcome.eligible === true &&
      amount <= o.amountCap;
    return {
      c,
      outcome,
      rawOutcome,
      candidate,
      calibrationPopulation: candidate && !c.inputs.evidence.possibleDuplicate,
      rawLogit: rawEvidenceLogit(c.inputs.evidence),
    };
  });
  const train = scored.filter((s) => s.c.split === 'train');
  const test = scored.filter((s) => s.c.split === 'test');

  // ---- calibration: fit on train, judge on held-out test ----
  const trainCand = train.filter((s) => s.calibrationPopulation);
  const testCand = test.filter((s) => s.calibrationPopulation);
  const fitted = fitPlatt(
    trainCand.map((s) => s.rawLogit),
    trainCand.map((s) => s.c.payable),
  );
  const ys = testCand.map((s) => s.c.payable);
  const rawP = testCand.map((s) => sigmoid(s.rawLogit));
  const calP = testCand.map((s) => sigmoid(fitted.a * s.rawLogit + fitted.b));
  const calibration = {
    method: 'Platt scaling (logistic regression on the raw evidence logit)',
    population:
      'claims that reach the confidence gate (verified, eligible by rule, no hard flag) without a near-duplicate identity; near-duplicates always go to a human',
    trainCandidates: trainCand.length,
    testCandidates: testCand.length,
    fitted: { a: round(fitted.a), b: round(fitted.b) },
    stored: PLATT,
    engineUses: ACTIVE_CALIBRATION ? 'calibrated' : 'raw',
    storedMatchesFit: Math.abs(PLATT.a - fitted.a) < 1e-4 && Math.abs(PLATT.b - fitted.b) < 1e-4,
    /** Raw evidence logit a claim needs to clear the threshold once calibrated */
    logitNeeded: round((Math.log(threshold / (1 - threshold)) - fitted.b) / fitted.a, 4),
    raw: calibrationScores(rawP, ys),
    calibrated: calibrationScores(calP, ys),
    reliability: reliabilityTable(calP, ys),
    reliabilityRaw: reliabilityTable(rawP, ys),
  };

  // ---- engine metrics on the test split (and the same engine with raw scores, for comparison) ----
  const metrics = laneMetrics(test, o.costs, (s) => s.outcome);
  const rawBaseline = laneMetrics(test, o.costs, (s) => s.rawOutcome);
  const byArchetype = ARCHETYPES.map(([a]) => {
    const rows = test.filter((s) => s.c.archetype === a);
    return {
      archetype: a as Archetype,
      ...countLanes(rows),
      payable: rows.filter((s) => s.c.payable).length,
    };
  });

  // ---- cost curve: same cases, auto-approve iff candidate and p ≥ t ----
  const n = test.length;
  const fixedCost = test
    .filter((s) => !s.candidate)
    .reduce((s, x) => s + laneCost(x.outcome.lane, o.costs), 0);
  const cand = test
    .filter((s) => s.candidate)
    .map((s) => ({ p: s.outcome.confidence, raw: s.rawOutcome.confidence, payable: s.c.payable }));
  const thresholds = [...new Set([...CURVE_THRESHOLDS, round(threshold, 3)])].sort((a, b) => a - b);
  const observedAt = (t: number, key: 'p' | 'raw') => {
    const auto = cand.filter((x) => x[key] >= t);
    const wrong = auto.filter((x) => !x.payable).length;
    const cost =
      fixedCost + wrong * o.costs.wrongApproval + (cand.length - auto.length) * o.costs.humanReview;
    return { auto: auto.length, wrong, perCase: round(cost / n, 2) };
  };
  const curve = thresholds.map((t) => {
    const cal = observedAt(t, 'p');
    const raw = observedAt(t, 'raw');
    const expected =
      fixedCost +
      cand.reduce(
        (s, x) => s + (x.p >= t ? (1 - x.p) * o.costs.wrongApproval : o.costs.humanReview),
        0,
      );
    return {
      threshold: t,
      automationRate: round(cal.auto / n, 4),
      wrongAutoApprovals: cal.wrong,
      observedCostPerCase: cal.perCase,
      expectedCostPerCase: round(expected / n, 2),
      raw: {
        automationRate: round(raw.auto / n, 4),
        wrongAutoApprovals: raw.wrong,
        observedCostPerCase: raw.perCase,
      },
    };
  });

  const headline = {
    datasetSeed: seed,
    datasetSize: size,
    testCases: n,
    threshold: round(threshold, 4),
    accuracyOnDecided: metrics.accuracyOnDecided,
    routingAccuracy: metrics.routingAccuracy,
    automationRate: metrics.automationRate,
    wrongAutoApprovals: metrics.wrongAutoApprovals.count,
    wrongAutoApprovalRate: metrics.wrongAutoApprovals.rate,
    falseAlarms: metrics.falseAlarms.count,
    costPerCase: metrics.cost.perCase,
    costPerCaseAllHuman: metrics.cost.allHumanPerCase,
    calibratedEce: calibration.calibrated.ece,
    rawEce: calibration.raw.ece,
  };

  return {
    headline,
    dataset: {
      seed,
      size,
      synthetic: true,
      split: { train: train.length, test: n },
      mix: ARCHETYPES.map(([a, w]) => ({ archetype: a, share: w })),
    },
    costs: { ...o.costs, threshold: round(threshold, 4), amountCap: o.amountCap },
    metrics,
    rawBaseline,
    byArchetype,
    calibration,
    costCurve: {
      basis:
        'test split. observed = cost from the true labels; expected = cost the calibrated probabilities predict; raw = same engine without calibration',
      points: curve,
      chosen: round(threshold, 4),
      observedMinimum: minRange(curve, 'observedCostPerCase'),
      expectedMinimum: minRange(curve, 'expectedCostPerCase'),
    },
  };
}

export type EvalReport = ReturnType<typeof runEvaluation>;

function laneCost(lane: Lane, c: CostSettings): number {
  return lane === 'HUMAN_REVIEW' ? c.humanReview : lane === 'ASK_MORE' ? c.askMore : 0;
}

function countLanes(rows: Scored[]) {
  const by = (l: Lane) => rows.filter((s) => s.outcome.lane === l).length;
  return {
    n: rows.length,
    autoApprove: by('AUTO_APPROVE'),
    humanReview: by('HUMAN_REVIEW'),
    askMore: by('ASK_MORE'),
  };
}

function laneMetrics(all: Scored[], costs: CostSettings, pick: (s: Scored) => DecisionOutcome) {
  const rows = all.map((s) => ({ ...s, outcome: pick(s) }));
  const n = rows.length;
  const auto = rows.filter((s) => s.outcome.lane === 'AUTO_APPROVE');
  const wrong = auto.filter((s) => !s.c.payable);
  const payable = rows.filter((s) => s.c.payable);
  const notPayable = rows.filter((s) => !s.c.payable);
  const falseAlarms = payable.filter((s) => s.outcome.lane !== 'AUTO_APPROVE');
  const reason = (s: Scored) =>
    s.outcome.lane === 'ASK_MORE'
      ? 'ask_more'
      : s.outcome.hardFlags.length
        ? `flag:${s.outcome.hardFlags[0]}`
        : s.outcome.eligible === false
          ? 'rule_not_met'
          : 'low_confidence';
  const tally = (xs: string[]) =>
    Object.fromEntries([...new Set(xs)].sort().map((k) => [k, xs.filter((x) => x === k).length]));
  const lanes = countLanes(rows);
  const total =
    wrong.length * costs.wrongApproval +
    lanes.humanReview * costs.humanReview +
    lanes.askMore * costs.askMore;
  const confusion = Object.fromEntries(
    (['AUTO_APPROVE', 'HUMAN_REVIEW', 'ASK_MORE'] as Lane[]).map((l) => {
      const inLane = rows.filter((s) => s.outcome.lane === l);
      return [
        l,
        {
          payable: inLane.filter((s) => s.c.payable).length,
          notPayable: inLane.filter((s) => !s.c.payable).length,
        },
      ];
    }),
  );
  return {
    cases: n,
    lanes,
    confusion,
    automationRate: round(auto.length / n, 4),
    automationOfPayable: round(
      payable.filter((s) => s.outcome.lane === 'AUTO_APPROVE').length / payable.length,
      4,
    ),
    /** Automation only ever approves, so "decided" = auto-approved */
    accuracyOnDecided: auto.length ? round(1 - wrong.length / auto.length, 4) : null,
    /** Payable → auto-approved, not payable → a human or a question */
    routingAccuracy: round((auto.length - wrong.length + notPayable.length - wrong.length) / n, 4),
    wrongAutoApprovals: {
      count: wrong.length,
      rate: auto.length ? round(wrong.length / auto.length, 4) : 0,
      upper95: auto.length ? round(wilsonUpper(wrong.length, auto.length), 4) : null,
      cases: wrong.map((s) => ({
        id: s.c.id,
        archetype: s.c.archetype,
        confidence: round(s.outcome.confidence, 4),
      })),
    },
    falseAlarms: {
      count: falseAlarms.length,
      rateOfPayable: round(falseAlarms.length / payable.length, 4),
      byReason: tally(falseAlarms.map(reason)),
    },
    fraudCaught: {
      caught: notPayable.length - wrong.length,
      of: notPayable.length,
      recall: notPayable.length
        ? round((notPayable.length - wrong.length) / notPayable.length, 4)
        : null,
    },
    cost: {
      total,
      perCase: round(total / n, 2),
      /** Baseline: every claim checked by an officer */
      allHumanPerCase: costs.humanReview,
    },
  };
}

/** Wilson score interval upper bound (95%) for k successes in n trials. */
export function wilsonUpper(k: number, n: number, z = 1.96): number {
  const p = k / n;
  const d = 1 + (z * z) / n;
  return (p + (z * z) / (2 * n) + z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
}

function minRange<K extends 'observedCostPerCase' | 'expectedCostPerCase'>(
  pts: { threshold: number; observedCostPerCase: number; expectedCostPerCase: number }[],
  key: K,
) {
  const min = Math.min(...pts.map((p) => p[key]));
  const at = pts.filter((p) => p[key] <= min + 1e-9).map((p) => p.threshold);
  return { costPerCase: min, from: Math.min(...at), to: Math.max(...at) };
}
