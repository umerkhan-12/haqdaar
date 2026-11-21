import jsonLogic, { type RulesLogic } from 'json-logic-js';
import { z } from 'zod';

/** Rules are data, never code: only JSON Logic's own operators are allowed (dry run on empty facts). */
function isKnownLogic(logic: unknown): boolean {
  if (!jsonLogic.is_logic(logic)) return false;
  try {
    jsonLogic.apply(logic as RulesLogic, {});
    return true;
  } catch {
    return false;
  }
}

/** One eligibility condition. Texts state the condition, so they read well as "met" / "not met". */
export const Clause = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  logic: z
    .record(z.unknown())
    .refine(isKnownLogic, 'Not a valid JSON Logic expression (unknown operator?)'),
  textUr: z.string().min(2).max(200),
  textEn: z.string().min(2).max(200),
});
export type Clause = z.infer<typeof Clause>;

export const RuleDefinition = z.object({
  clauses: z.array(Clause).min(1).max(20),
  amount: z.number().int().positive().max(100_000),
  notes: z.string().max(500).optional(),
});
export type RuleDefinition = z.infer<typeof RuleDefinition>;

/** Facts the rules can read with `{ "var": "..." }`. Built from verified sources, not from the claim alone. */
export interface Facts {
  claim: {
    fullName: string;
    district: string | null;
    householdSize: number | null;
    isWidow: boolean | null;
  };
  nadra: {
    match: boolean;
    nameScore: number;
    deceased: boolean;
    maritalStatus: string;
    gender: string;
    district: string;
  } | null;
  household: {
    householdSize: number;
    monthlyIncomePkr: number;
    district: string;
    pmtScore: number;
  } | null;
}

export interface ClauseResult {
  id: string;
  passed: boolean;
}

export function combinedLogic(clauses: Clause[]): RulesLogic {
  return { and: clauses.map((c) => c.logic as RulesLogic) };
}

/** Evaluate every clause (not short-circuited) so the explanation can list each one. */
export function evaluateRules(
  clauses: Clause[],
  facts: Facts,
): { eligible: boolean; results: ClauseResult[] } {
  const results = clauses.map((c) => ({
    id: c.id,
    passed: jsonLogic.apply(c.logic as RulesLogic, facts) === true,
  }));
  return { eligible: results.every((r) => r.passed), results };
}

export const PROGRAM_DISTRICTS = ['Thatta', 'Sujawal', 'Badin', 'Tharparkar', 'Karachi West'];

/** Sahara Program rule v1 (seeded, published). */
export const SAHARA_V1: RuleDefinition = {
  amount: 12_000,
  notes: 'Sahara Program v1: widows or large low-income households in program districts.',
  clauses: [
    {
      id: 'alive',
      logic: { '==': [{ var: 'nadra.deceased' }, false] },
      textUr: 'شناختی ریکارڈ کے مطابق درخواست گزار حیات ہیں',
      textEn: 'The applicant is alive according to the identity record',
    },
    {
      id: 'program_district',
      logic: { in: [{ var: 'household.district' }, PROGRAM_DISTRICTS] },
      textUr: 'گھرانہ پروگرام کے ضلع میں رہتا ہے',
      textEn: 'The household lives in a program district',
    },
    {
      id: 'vulnerable',
      logic: {
        or: [
          { '==': [{ var: 'nadra.maritalStatus' }, 'widowed'] },
          { '>=': [{ var: 'household.householdSize' }, 5] },
        ],
      },
      textUr: 'درخواست گزار بیوہ ہیں یا گھر میں پانچ یا زیادہ افراد ہیں',
      textEn: 'The applicant is a widow or the household has 5 or more members',
    },
    {
      id: 'low_income',
      logic: { '<': [{ var: 'household.monthlyIncomePkr' }, 40_000] },
      textUr: 'گھر کی ماہانہ آمدن چالیس ہزار روپے سے کم ہے',
      textEn: 'Monthly household income is below PKR 40,000',
    },
  ],
};
