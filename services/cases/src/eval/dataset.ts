import { PROGRAM_DISTRICTS, type Facts } from '../engine/rules';
import { nameSimilarity } from '../engine/names';
import type { DecisionInputs, Evidence, HardFlag } from '../engine/decide';
import { otherName, personName, relatedName, writtenAs } from './synthetic-names';

/**
 * Synthetic labelled decision inputs — seeded, so the same seed always gives the same cases.
 *
 * Names are real-looking Pakistani names; the claimed name is the record name written with 0–3 small changes
 * (known/unknown spelling variants, typos, word order, dropped or extra token, caps, "Mst.", Urdu script), and the
 * name score is the engine's own `nameSimilarity` — not a drawn number.
 *
 * Generation rules (share of cases → what the engine sees → ground truth `payable`):
 * - eligible_clean 34%: name as on record (cosmetic changes only), all checks pass → payable.
 * - eligible_variant 12%: one spelling change → payable.
 * - borderline_name 6%: two or three changes (some fall under the .80 name gate) → payable.
 * - eligible_namesake 4%: genuine, but another person with a near-identical name exists (possibleDuplicate) → payable.
 * - ineligible 14%: verified identity, fails a rule (income ≥ 40k 50%, outside program district 30%, not vulnerable 20%) → not payable.
 * - fraud_identity 8%: someone else's CNIC; 30% CNIC not found, else NADRA matches the CNIC but the claimant is a
 *   relative/neighbour sharing one name token (45%) or a stranger (55%) → not payable.
 * - fraud_deceased 4%: claim on a deceased person's CNIC → not payable.
 * - fraud_duplicate 8%: half a second claim on the same CNIC this month, half a ghost namesake (possibleDuplicate) → not payable.
 * - missing_data 10%: consent missing 50%, household record missing 25%, verification down 25% → payable 70%.
 * Voice claims are 45% of the total and carry an extraction confidence ~ U(.55, 1); typed claims carry none.
 * Label noise: 0.3% of the four payable-looking groups are in truth not payable and look clean to every check
 * (collusion, stale household data) — the floor no engine on this evidence can beat.
 */

export const ARCHETYPES = [
  ['eligible_clean', 0.34],
  ['eligible_variant', 0.12],
  ['borderline_name', 0.06],
  ['eligible_namesake', 0.04],
  ['ineligible', 0.14],
  ['fraud_identity', 0.08],
  ['fraud_deceased', 0.04],
  ['fraud_duplicate', 0.08],
  ['missing_data', 0.1],
] as const;

export type Archetype = (typeof ARCHETYPES)[number][0];

export interface LabelledCase {
  id: string;
  archetype: Archetype;
  /** Ground truth: paying this claim is the right outcome */
  payable: boolean;
  split: 'train' | 'test';
  names: { claimed: string; record: string };
  inputs: DecisionInputs;
}

export const DEFAULT_SEED = 2026;
export const DEFAULT_SIZE = 500;
export const TEST_SHARE = 0.4;

/** mulberry32: tiny, fast, good enough for test data. */
export function prng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    uniform: (lo: number, hi: number) => lo + (hi - lo) * next(),
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
  };
}
type Rng = ReturnType<typeof prng>;

const OUTSIDE_DISTRICTS = ['Lahore', 'Hyderabad', 'Sukkur', 'Quetta', 'Peshawar'];
export const HIDDEN_FRAUD_RATE = 0.003;
const LOOKS_PAYABLE: Archetype[] = [
  'eligible_clean',
  'eligible_variant',
  'borderline_name',
  'eligible_namesake',
];

interface Draft {
  claimed: string;
  match?: boolean;
  deceased?: boolean;
  widow?: boolean;
  householdSize?: number;
  income?: number;
  district?: string;
  household?: boolean;
  nadra?: boolean;
  possibleDuplicate?: boolean;
  externalFlags?: HardFlag[];
  missing?: string[];
}

/** A household that passes every Sahara v1 clause. */
function eligibleProfile(r: Rng) {
  const widow = r.chance(0.7);
  return {
    widow,
    householdSize: widow ? r.int(1, 8) : r.int(5, 10),
    income: r.int(8, 39) * 1000,
    district: r.pick(PROGRAM_DISTRICTS),
  };
}

function draftFor(a: Archetype, record: string, r: Rng): Draft {
  const ok = eligibleProfile(r);
  const own = (edits: number) => ({ ...ok, claimed: writtenAs(record, edits, r) });
  switch (a) {
    case 'eligible_clean':
      return own(0);
    case 'eligible_variant':
      return own(1);
    case 'borderline_name':
      return own(r.int(2, 3));
    case 'eligible_namesake':
      return { ...own(0), possibleDuplicate: true };
    case 'ineligible': {
      const why = r.next();
      const base = own(r.chance(0.7) ? 0 : 1);
      if (why < 0.5) return { ...base, income: r.int(40, 95) * 1000 };
      if (why < 0.8) return { ...base, district: r.pick(OUTSIDE_DISTRICTS) };
      return { ...base, widow: false, householdSize: r.int(1, 4) };
    }
    case 'fraud_identity':
      if (r.chance(0.3)) return { ...ok, claimed: otherName(record, r), match: false };
      return { ...ok, claimed: r.chance(0.45) ? relatedName(record, r) : otherName(record, r) };
    case 'fraud_deceased':
      return { ...own(r.int(0, 1)), deceased: true };
    case 'fraud_duplicate':
      return r.chance(0.5)
        ? { ...own(0), externalFlags: ['duplicate_claim_this_month'] }
        : { ...own(r.int(0, 1)), possibleDuplicate: true };
    case 'missing_data': {
      const why = r.next();
      if (why < 0.5) {
        const missing = r.chance(0.5)
          ? ['consent:household_data']
          : ['consent:identity_verification', 'consent:household_data'];
        return { ...own(0), nadra: false, household: false, missing };
      }
      if (why < 0.75)
        return { ...own(r.int(0, 1)), household: false, externalFlags: ['household_not_found'] };
      return {
        ...own(0),
        nadra: false,
        household: false,
        externalFlags: ['verification_unavailable'],
      };
    }
  }
}

function payableFor(a: Archetype, r: Rng): boolean {
  if (a === 'missing_data') return r.chance(0.7);
  if (LOOKS_PAYABLE.includes(a)) return !r.chance(HIDDEN_FRAUD_RATE);
  return false;
}

function toInputs(d: Draft, record: string, r: Rng): DecisionInputs {
  const voice = r.chance(0.45);
  const district = d.district ?? 'Thatta';
  const withNadra = d.nadra !== false;
  const withHousehold = withNadra && d.household !== false;
  const match = withNadra && d.match !== false;
  const nameScore = match ? nameSimilarity(d.claimed, record) : 0;
  const facts: Facts = {
    claim: {
      fullName: d.claimed,
      district,
      householdSize: d.householdSize ?? null,
      isWidow: d.widow ?? null,
    },
    nadra: withNadra
      ? {
          match,
          nameScore,
          deceased: d.deceased ?? false,
          maritalStatus: !match ? 'unknown' : d.widow ? 'widowed' : 'married',
          gender: 'F',
          district,
        }
      : null,
    household: withHousehold
      ? {
          householdSize: d.householdSize ?? 1,
          monthlyIncomePkr: d.income ?? 0,
          district,
          pmtScore: r.int(5, 40),
        }
      : null,
  };
  const evidence: Evidence = {
    nadraMatch: match,
    nameScore,
    householdVerified: withHousehold,
    extractionConfidence: voice ? r.uniform(0.55, 1) : null,
    possibleDuplicate: d.possibleDuplicate ?? false,
  };
  return { facts, evidence, externalFlags: d.externalFlags ?? [], missing: d.missing ?? [] };
}

/** Archetype counts by largest remainder, so the mix is exact for any size. */
function archetypeCounts(size: number): [Archetype, number][] {
  const raw = ARCHETYPES.map(([a, w]) => [a, w * size] as const);
  const counts = raw.map(([a, x]) => [a, Math.floor(x)] as [Archetype, number]);
  let left = size - counts.reduce((s, [, n]) => s + n, 0);
  const order = raw.map(([, x], i) => [x - Math.floor(x), i] as const).sort((p, q) => q[0] - p[0]);
  for (const [, i] of order) if (left-- > 0) counts[i][1]++;
  return counts;
}

/** Deterministic dataset with a stratified train/test split (TEST_SHARE of each archetype held out). */
export function generateDataset(seed = DEFAULT_SEED, size = DEFAULT_SIZE): LabelledCase[] {
  const r = prng(seed);
  const out: LabelledCase[] = [];
  for (const [archetype, n] of archetypeCounts(size)) {
    const nTest = Math.round(n * TEST_SHARE);
    const testIdx = new Set(shuffle([...Array(n).keys()], r).slice(0, nTest));
    for (let i = 0; i < n; i++) {
      const record = personName(r);
      const draft = draftFor(archetype, record, r);
      out.push({
        id: `${archetype}-${String(i).padStart(3, '0')}`,
        archetype,
        payable: payableFor(archetype, r),
        split: testIdx.has(i) ? 'test' : 'train',
        names: { claimed: draft.claimed, record },
        inputs: toInputs(draft, record, r),
      });
    }
  }
  return out;
}

function shuffle<T>(xs: T[], r: Rng): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}
