import { autoApproveThreshold, type CostSettings, type Lane } from '@haqdaar/shared';
import { evaluateRules, type Clause, type ClauseResult, type Facts } from './rules';
import { ACTIVE_CALIBRATION, sigmoid, type PlattParams } from './calibration';

/** Evidence quality signals that feed the confidence score. */
export interface Evidence {
  nadraMatch: boolean;
  /** Claimed name vs identity record, 0..1 */
  nameScore: number;
  householdVerified: boolean;
  /** AI extraction confidence when the claim came from voice; null for typed claims */
  extractionConfidence: number | null;
  /** Another person with a very similar name exists under a different CNIC */
  possibleDuplicate: boolean;
}

export type HardFlag =
  | 'deceased'
  | 'identity_not_found'
  | 'name_mismatch'
  | 'duplicate_claim_this_month'
  | 'household_not_found'
  | 'verification_unavailable';

/** Snapshot stored with every decision so the Digital Twin can replay it under another rule. */
export interface DecisionInputs {
  facts: Facts;
  evidence: Evidence;
  /** Flags found outside the facts (other cases, unavailable services) */
  externalFlags: HardFlag[];
  /** Missing information or consent, e.g. `consent:household_data` */
  missing: string[];
}

export interface DecisionContext {
  clauses: Clause[];
  amount: number;
  costs: CostSettings;
  amountCap: number;
  /** Platt parameters for the confidence score; defaults to the engine's fitted ones (null = raw score) */
  calibration?: PlattParams | null;
}

export interface DecisionOutcome {
  lane: Lane;
  confidence: number;
  threshold: number;
  eligible: boolean | null;
  clauses: ClauseResult[];
  hardFlags: HardFlag[];
  explanationUr: string;
  explanationEn: string;
}

export const NAME_MATCH_MIN = 0.8;

/**
 * Raw evidence score (logit) with hand-set weights: it orders cases, but its scale is not a probability.
 * `confidenceScore` maps it to a calibrated probability with Platt scaling fitted on the labelled set.
 */
const W = { bias: -4, nadraMatch: 3, nameScore: 4, householdVerified: 2, extraction: 1, duplicate: -3 };
const DEFAULT_EXTRACTION_CONFIDENCE = 0.8;

export function rawEvidenceLogit(e: Evidence): number {
  return (
    W.bias +
    W.nadraMatch * Number(e.nadraMatch) +
    W.nameScore * e.nameScore +
    W.householdVerified * Number(e.householdVerified) +
    W.extraction * (e.extractionConfidence ?? DEFAULT_EXTRACTION_CONFIDENCE) +
    W.duplicate * Number(e.possibleDuplicate)
  );
}

/** Confidence that approving is correct, from evidence. */
export function confidenceScore(e: Evidence, platt: PlattParams | null = ACTIVE_CALIBRATION): number {
  const z = rawEvidenceLogit(e);
  return platt ? sigmoid(platt.a * z + platt.b) : sigmoid(z);
}

export function deriveHardFlags(facts: Facts, evidence: Evidence): HardFlag[] {
  const flags: HardFlag[] = [];
  if (facts.nadra && !facts.nadra.match) flags.push('identity_not_found');
  if (facts.nadra?.deceased) flags.push('deceased');
  if (facts.nadra?.match && evidence.nameScore < NAME_MATCH_MIN) flags.push('name_mismatch');
  return flags;
}

/**
 * The decision engine. Automation may approve (when very sure) or escalate — it never rejects.
 * Only a human can say no.
 */
export function decide(input: DecisionInputs, ctx: DecisionContext): DecisionOutcome {
  const threshold = autoApproveThreshold(ctx.costs);
  const hardFlags = [...new Set([...input.externalFlags, ...deriveHardFlags(input.facts, input.evidence)])];
  const base = { threshold, hardFlags };

  if (input.missing.length) {
    return {
      ...base,
      lane: 'ASK_MORE',
      confidence: 0,
      eligible: null,
      clauses: [],
      ...explainAskMore(input.missing),
    };
  }

  const verified = !!(input.facts.nadra && input.facts.household);
  const calibration = ctx.calibration === undefined ? ACTIVE_CALIBRATION : ctx.calibration;
  const confidence = verified ? confidenceScore(input.evidence, calibration) : 0;
  const { eligible, results } = verified
    ? evaluateRules(ctx.clauses, input.facts)
    : { eligible: false, results: [] as ClauseResult[] };

  if (hardFlags.length || !eligible) {
    return {
      ...base,
      lane: 'HUMAN_REVIEW',
      confidence,
      eligible: verified ? eligible : null,
      clauses: results,
      ...explainReview(hardFlags, results, ctx.clauses, null),
    };
  }

  if (confidence >= threshold && ctx.amount <= ctx.amountCap) {
    return { ...base, lane: 'AUTO_APPROVE', confidence, eligible, clauses: results, ...explainApproved(results, ctx.clauses) };
  }

  const reason = ctx.amount > ctx.amountCap ? 'amount_cap' : 'low_confidence';
  return {
    ...base,
    lane: 'HUMAN_REVIEW',
    confidence,
    eligible,
    clauses: results,
    ...explainReview([], results, ctx.clauses, reason),
  };
}

// ---------- deterministic explanations (Urdu first, English for staff) ----------

const MISSING_TEXT: Record<string, [string, string]> = {
  'consent:identity_verification': [
    'شناخت کی تصدیق کے لیے آپ کی اجازت',
    'your permission to verify your identity',
  ],
  'consent:household_data': ['گھریلو معلومات دیکھنے کے لیے آپ کی اجازت', 'your permission to check household data'],
  fullName: ['آپ کا پورا نام', 'your full name'],
  cnic: ['آپ کا شناختی کارڈ نمبر', 'your CNIC number'],
};

const FLAG_TEXT: Record<HardFlag, [string, string]> = {
  deceased: ['شناختی ریکارڈ میں یہ شخص وفات شدہ درج ہے', 'the identity record lists this person as deceased'],
  identity_not_found: ['شناختی کارڈ نمبر ریکارڈ میں نہیں ملا', 'the CNIC was not found in the identity record'],
  name_mismatch: ['نام شناختی ریکارڈ سے پوری طرح نہیں ملتا', 'the name does not fully match the identity record'],
  duplicate_claim_this_month: [
    'اس مہینے اس شناختی کارڈ پر پہلے ہی درخواست موجود ہے',
    'a claim for this CNIC already exists this month',
  ],
  household_not_found: ['گھریلو ریکارڈ نہیں ملا', 'no household record was found'],
  verification_unavailable: ['تصدیقی نظام ابھی دستیاب نہیں', 'verification systems are unavailable right now'],
};

const REASON_TEXT = {
  low_confidence: ['ہمیں پوری طرح یقین نہیں، اس لیے ایک افسر تصدیق کرے گا', 'we are not fully sure, so an officer will check'],
  amount_cap: ['اس رقم کے لیے افسر کی منظوری ضروری ہے', 'this amount needs an officer’s approval'],
} as const;

function clauseTexts(results: ClauseResult[], clauses: Clause[], passed: boolean) {
  const byId = new Map(clauses.map((c) => [c.id, c]));
  const picked = results.filter((r) => r.passed === passed).map((r) => byId.get(r.id)!).filter(Boolean);
  return { ur: picked.map((c) => c.textUr), en: picked.map((c) => c.textEn) };
}

function explainAskMore(missing: string[]) {
  const items = missing.map((m) => MISSING_TEXT[m] ?? [m, m]);
  return {
    explanationUr: `ہمیں مزید معلومات چاہییں: ${items.map((i) => i[0]).join('، ')}۔`,
    explanationEn: `We need more information: ${items.map((i) => i[1]).join(', ')}.`,
  };
}

function explainApproved(results: ClauseResult[], clauses: Clause[]) {
  const t = clauseTexts(results, clauses, true);
  return {
    explanationUr: `آپ کی درخواست منظور ہو گئی کیونکہ: ${t.ur.join('، ')}۔`,
    explanationEn: `Approved because: ${t.en.join('; ')}.`,
  };
}

function explainReview(
  flags: HardFlag[],
  results: ClauseResult[],
  clauses: Clause[],
  reason: keyof typeof REASON_TEXT | null,
) {
  const failed = clauseTexts(results, clauses, false);
  const ur = [
    ...flags.map((f) => FLAG_TEXT[f][0]),
    ...failed.ur.map((t) => `یہ شرط پوری نہیں ہوئی: ${t}`),
    ...(reason ? [REASON_TEXT[reason][0]] : []),
  ];
  const en = [
    ...flags.map((f) => FLAG_TEXT[f][1]),
    ...failed.en.map((t) => `not met: ${t}`),
    ...(reason ? [REASON_TEXT[reason][1]] : []),
  ];
  return {
    explanationUr: `ایک افسر آپ کی درخواست دیکھے گا۔ ${ur.join('۔ ')}۔`,
    explanationEn: `An officer will review this claim: ${en.join('; ')}.`,
  };
}
