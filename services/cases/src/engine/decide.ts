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
const W = {
  bias: -4,
  nadraMatch: 3,
  nameScore: 4,
  householdVerified: 2,
  extraction: 1,
  duplicate: -3,
};
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
export function confidenceScore(
  e: Evidence,
  platt: PlattParams | null = ACTIVE_CALIBRATION,
): number {
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

/** Inputs are replayed from the database and filled from other services: `unknown` until proven well-formed. */
type Loose = Record<string, unknown>;
const isObject = (v: unknown): v is Loose =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const unit = (v: unknown): number | null => (typeof v === 'number' && v >= 0 && v <= 1 ? v : null);

const EMPTY_CLAIM: Facts['claim'] = {
  fullName: '',
  district: null,
  householdSize: null,
  isWidow: null,
};

/**
 * Make any stored or upstream value safe to decide on. Anything malformed is dropped and reported, so the
 * caller can fail closed (a human looks) instead of crashing the claim or guessing.
 */
function sanitize(raw: unknown): { input: DecisionInputs; malformed: boolean } {
  let malformed = false;
  const bad = <T>(fallback: T): T => {
    malformed = true;
    return fallback;
  };
  const root = isObject(raw) ? raw : bad<Loose>({});
  const facts = isObject(root.facts) ? root.facts : bad<Loose>({});
  const ev = isObject(root.evidence) ? root.evidence : bad<Loose>({});

  const n = facts.nadra;
  const nadra =
    n === null || n === undefined
      ? null
      : isObject(n) && typeof n.match === 'boolean' && typeof n.deceased === 'boolean'
        ? (n as unknown as NonNullable<Facts['nadra']>)
        : bad(null);
  const h = facts.household;
  const household =
    h === null || h === undefined
      ? null
      : isObject(h) &&
          Number.isFinite(h.householdSize) &&
          Number.isFinite(h.monthlyIncomePkr) &&
          typeof h.district === 'string'
        ? (h as unknown as NonNullable<Facts['household']>)
        : bad(null);

  const strings = (v: unknown): string[] => {
    const list = Array.isArray(v) ? v : bad<unknown[]>([]);
    return [
      ...new Set(
        list.filter((x): x is string => (typeof x === 'string' && x.length > 0) || bad(false)),
      ),
    ];
  };
  const extraction = ev.extractionConfidence;

  return {
    input: {
      facts: {
        claim: isObject(facts.claim) ? (facts.claim as unknown as Facts['claim']) : EMPTY_CLAIM,
        nadra,
        household,
      },
      evidence: {
        // Evidence can never claim more than the records show.
        nadraMatch: ev.nadraMatch === true && nadra?.match === true,
        nameScore: unit(ev.nameScore) ?? bad(0),
        householdVerified: ev.householdVerified === true && household !== null,
        extractionConfidence:
          extraction === null || extraction === undefined ? null : (unit(extraction) ?? bad(0)),
        possibleDuplicate: ev.possibleDuplicate !== false,
      },
      externalFlags: strings(root.externalFlags) as HardFlag[],
      missing: strings(root.missing),
    },
    malformed,
  };
}

/** Costs must describe a real trade-off (0 < review < wrong approval); otherwise nothing is approved automatically. */
function safeThreshold(costs: unknown): number | null {
  if (!isObject(costs)) return null;
  const { wrongApproval: w, humanReview: h } = costs;
  if (
    typeof w !== 'number' ||
    typeof h !== 'number' ||
    !Number.isFinite(w) ||
    !Number.isFinite(h) ||
    h <= 0 ||
    w <= h
  )
    return null;
  return autoApproveThreshold(costs as unknown as CostSettings);
}

function safeCalibration(c: unknown): PlattParams | null {
  if (c === null) return null;
  return isObject(c) && Number.isFinite(c.a) && Number.isFinite(c.b) && (c.a as number) > 0
    ? (c as unknown as PlattParams)
    : ACTIVE_CALIBRATION;
}

/**
 * The decision engine. Automation may approve (when very sure) or escalate — it never rejects.
 * Only a human can say no. It is total: malformed input or settings never throw, they go to a human.
 */
export function decide(rawInput: DecisionInputs, rawCtx: DecisionContext): DecisionOutcome {
  const { input, malformed } = sanitize(rawInput);
  const ctx: Partial<DecisionContext> = isObject(rawCtx) ? rawCtx : {};
  const clauses = Array.isArray(ctx.clauses) ? ctx.clauses : [];
  const costThreshold = safeThreshold(ctx.costs);
  const threshold = costThreshold ?? 1;
  const hardFlags = [
    ...new Set<HardFlag>([
      ...input.externalFlags,
      ...deriveHardFlags(input.facts, input.evidence),
      ...(malformed ? (['verification_unavailable'] as const) : []),
    ]),
  ];
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
  const confidence = verified
    ? confidenceScore(input.evidence, safeCalibration(ctx.calibration))
    : 0;
  const { eligible, results } = verified
    ? evaluateRules(clauses, input.facts)
    : { eligible: false, results: [] as ClauseResult[] };

  if (hardFlags.length || !eligible) {
    return {
      ...base,
      lane: 'HUMAN_REVIEW',
      confidence,
      eligible: verified ? eligible : null,
      clauses: results,
      ...explainReview(hardFlags, results, clauses, null),
    };
  }

  const amountOk =
    typeof ctx.amount === 'number' &&
    typeof ctx.amountCap === 'number' &&
    ctx.amount > 0 &&
    ctx.amount <= ctx.amountCap;
  if (costThreshold !== null && confidence >= threshold && amountOk) {
    return {
      ...base,
      lane: 'AUTO_APPROVE',
      confidence,
      eligible,
      clauses: results,
      ...explainApproved(results, clauses),
    };
  }

  const reason = amountOk ? 'low_confidence' : 'amount_cap';
  return {
    ...base,
    lane: 'HUMAN_REVIEW',
    confidence,
    eligible,
    clauses: results,
    ...explainReview([], results, clauses, reason),
  };
}

// ---------- deterministic explanations (Urdu first, English for staff) ----------

const MISSING_TEXT: Record<string, [string, string]> = {
  'consent:identity_verification': [
    'شناخت کی تصدیق کے لیے آپ کی اجازت',
    'your permission to verify your identity',
  ],
  'consent:household_data': [
    'گھریلو معلومات دیکھنے کے لیے آپ کی اجازت',
    'your permission to check household data',
  ],
  fullName: ['آپ کا پورا نام', 'your full name'],
  cnic: ['آپ کا شناختی کارڈ نمبر', 'your CNIC number'],
};

const FLAG_TEXT: Record<HardFlag, [string, string]> = {
  deceased: [
    'شناختی ریکارڈ میں یہ شخص وفات شدہ درج ہے',
    'the identity record lists this person as deceased',
  ],
  identity_not_found: [
    'شناختی کارڈ نمبر ریکارڈ میں نہیں ملا',
    'the CNIC was not found in the identity record',
  ],
  name_mismatch: [
    'نام شناختی ریکارڈ سے پوری طرح نہیں ملتا',
    'the name does not fully match the identity record',
  ],
  duplicate_claim_this_month: [
    'اس مہینے اس شناختی کارڈ پر پہلے ہی درخواست موجود ہے',
    'a claim for this CNIC already exists this month',
  ],
  household_not_found: ['گھریلو ریکارڈ نہیں ملا', 'no household record was found'],
  verification_unavailable: [
    'تصدیقی نظام ابھی دستیاب نہیں',
    'verification systems are unavailable right now',
  ],
};

const REASON_TEXT = {
  low_confidence: [
    'ہمیں پوری طرح یقین نہیں، اس لیے ایک افسر تصدیق کرے گا',
    'we are not fully sure, so an officer will check',
  ],
  amount_cap: ['اس رقم کے لیے افسر کی منظوری ضروری ہے', 'this amount needs an officer’s approval'],
} as const;

function clauseTexts(results: ClauseResult[], clauses: Clause[], passed: boolean) {
  const byId = new Map(clauses.filter(isObject).map((c) => [c.id, c]));
  const picked = results
    .filter((r) => r.passed === passed)
    .map((r) => byId.get(r.id))
    .filter((c): c is Clause => typeof c?.textUr === 'string' && typeof c.textEn === 'string');
  return { ur: picked.map((c) => c.textUr), en: picked.map((c) => c.textEn) };
}

/** Shown for anything without its own sentence: a raw id (or whatever a client sent) is never read out to a citizen. */
const OTHER_MISSING: [string, string] = ['کچھ مزید معلومات', 'some more details'];
const OTHER_FLAG: [string, string] = [
  'اس درخواست کو افسر کی تصدیق درکار ہے',
  'this claim needs an officer’s check',
];

const textOf = (table: Record<string, [string, string]>, key: string, other: [string, string]) =>
  Object.hasOwn(table, key) ? table[key]! : other;

function explainAskMore(missing: string[]) {
  const items = [...new Set(missing.map((m) => textOf(MISSING_TEXT, m, OTHER_MISSING)))];
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
  const flagTexts = [...new Set(flags.map((f) => textOf(FLAG_TEXT, f, OTHER_FLAG)))];
  // Never an empty reason: with nothing specific to say (e.g. records missing), say that an officer must check.
  if (!flagTexts.length && !failed.ur.length && !reason) flagTexts.push(OTHER_FLAG);
  const ur = [
    ...flagTexts.map((t) => t[0]),
    ...failed.ur.map((t) => `یہ شرط پوری نہیں ہوئی: ${t}`),
    ...(reason ? [REASON_TEXT[reason][0]] : []),
  ];
  const en = [
    ...flagTexts.map((t) => t[1]),
    ...failed.en.map((t) => `not met: ${t}`),
    ...(reason ? [REASON_TEXT[reason][1]] : []),
  ];
  return {
    explanationUr: `ایک افسر آپ کی درخواست دیکھے گا۔ ${ur.join('۔ ')}۔`,
    explanationEn: `An officer will review this claim: ${en.join('; ')}.`,
  };
}
