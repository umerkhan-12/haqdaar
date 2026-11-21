import { sigmoid, type PlattParams } from '../engine/calibration';

/**
 * Platt scaling: logistic regression p = σ(a·x + b) on the engine's raw evidence logit x.
 * Newton–Raphson with Platt's smoothed targets, so a clean training set cannot push p to exactly 0 or 1.
 */
export function fitPlatt(xs: number[], ys: boolean[]): PlattParams {
  const nPos = ys.filter(Boolean).length;
  const nNeg = ys.length - nPos;
  const hi = (nPos + 1) / (nPos + 2);
  const lo = 1 / (nNeg + 2);
  const t = ys.map((y) => (y ? hi : lo));
  let a = 0;
  let b = Math.log((nPos + 1) / (nNeg + 1));
  const loss = (a: number, b: number) =>
    xs.reduce((s, x, i) => {
      const z = a * x + b;
      // −[t log σ(z) + (1−t) log(1−σ(z))], written stably
      return (
        s +
        (z >= 0 ? (1 - t[i]) * z + Math.log1p(Math.exp(-z)) : -t[i] * z + Math.log1p(Math.exp(z)))
      );
    }, 0);

  for (let iter = 0; iter < 100; iter++) {
    let ga = 0,
      gb = 0,
      haa = 1e-9,
      hab = 0,
      hbb = 1e-9;
    xs.forEach((x, i) => {
      const p = sigmoid(a * x + b);
      const d = p - t[i];
      const w = p * (1 - p);
      ga += d * x;
      gb += d;
      haa += w * x * x;
      hab += w * x;
      hbb += w;
    });
    if (Math.abs(ga) < 1e-10 && Math.abs(gb) < 1e-10) break;
    const det = haa * hbb - hab * hab;
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    const f0 = loss(a, b);
    let step = 1;
    while (step > 1e-8 && loss(a - step * da, b - step * db) > f0 + 1e-12) step /= 2;
    a -= step * da;
    b -= step * db;
    if (Math.abs(step * da) < 1e-12 && Math.abs(step * db) < 1e-12) break;
  }
  return { a, b };
}

export interface ReliabilityBin {
  bin: number;
  /** Predicted probability range covered by this bin */
  from: number;
  to: number;
  n: number;
  /** Mean predicted probability of approving correctly */
  predicted: number | null;
  /** Share that really was payable */
  observed: number | null;
}

/**
 * Reliability table in 10 equal-count bins (deciles of predicted p).
 * Almost every candidate scores above 0.9, so equal-width bins would put everything in one bin.
 */
export function reliabilityTable(ps: number[], ys: boolean[], bins = 10): ReliabilityBin[] {
  const order = ps.map((p, i) => [p, ys[i]] as const).sort((x, y) => x[0] - y[0]);
  return Array.from({ length: bins }, (_, k) => {
    const slice = order.slice(
      Math.floor((k * order.length) / bins),
      Math.floor(((k + 1) * order.length) / bins),
    );
    const n = slice.length;
    return {
      bin: k + 1,
      from: n ? round(slice[0][0]) : 0,
      to: n ? round(slice[n - 1][0]) : 0,
      n,
      predicted: n ? round(slice.reduce((s, [p]) => s + p, 0) / n) : null,
      observed: n ? round(slice.filter(([, y]) => y).length / n) : null,
    };
  });
}

export interface CalibrationScores {
  n: number;
  brier: number;
  logLoss: number;
  /** Expected calibration error over the reliability bins (count-weighted |predicted − observed|) */
  ece: number;
}

export function calibrationScores(ps: number[], ys: boolean[]): CalibrationScores {
  const n = ps.length;
  const eps = 1e-12;
  const brier = ps.reduce((s, p, i) => s + (p - Number(ys[i])) ** 2, 0) / n;
  const logLoss =
    -ps.reduce(
      (s, p, i) => s + (ys[i] ? Math.log(Math.max(p, eps)) : Math.log(Math.max(1 - p, eps))),
      0,
    ) / n;
  const ece = reliabilityTable(ps, ys).reduce(
    (s, b) =>
      s +
      (b.n && b.predicted !== null && b.observed !== null
        ? (b.n / n) * Math.abs(b.predicted - b.observed)
        : 0),
    0,
  );
  return { n, brier: round(brier), logLoss: round(logLoss), ece: round(ece) };
}

export function round(x: number, digits = 6): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
