export interface PlattParams {
  a: number;
  b: number;
}

export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/**
 * Platt scaling for the confidence score: p = σ(a·z + b), z = raw evidence logit.
 * Fitted by `src/eval` on the training split of the synthetic labelled set (seed 2026, 500 cases), on claims that
 * reach the confidence gate without a near-duplicate identity. Fitted range z ≈ 5–6; below that, p only orders
 * cases (they go to a human anyway). A unit test refits and fails if these drift from what the data gives.
 * With these values a claim needs z ≥ 5.747 to clear 0.988 (raw scores cleared it from z ≥ 4.41).
 */
export const PLATT: PlattParams = { a: 5.444271304, b: -26.87709434 };

/** What `decide` uses. null = the raw score. */
export const ACTIVE_CALIBRATION: PlattParams | null = PLATT;
