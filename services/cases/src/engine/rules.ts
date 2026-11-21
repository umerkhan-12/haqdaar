import jsonLogic, { type RulesLogic } from 'json-logic-js';
import { z } from 'zod';

/** The JSON Logic operators a rule may use. Anything else (`method`, `log`, typos, made-up names) is refused. */
const OPERATORS = new Set([
  'var',
  'missing',
  'missing_some',
  'if',
  '?:',
  '==',
  '===',
  '!=',
  '!==',
  '!',
  '!!',
  'or',
  'and',
  '>',
  '>=',
  '<',
  '<=',
  'max',
  'min',
  '+',
  '-',
  '*',
  '/',
  '%',
  'map',
  'filter',
  'reduce',
  'all',
  'none',
  'some',
  'merge',
  'in',
  'cat',
  'substr',
]);
const MAX_DEPTH = 16;
const MAX_NODES = 400;
/** `household.district`, `nadra.deceased`, or '' (the current item inside map/filter/reduce). */
const VAR_PATH = /^$|^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;
/** Keys that reach into JavaScript's own machinery instead of the facts. */
const UNSAFE = /__proto__|prototype|constructor/;

/**
 * Checks the WHOLE tree, not only the branches a dry run happens to take: `and`/`or`/`if` short-circuit, so an
 * unknown operator hidden behind a condition would pass a dry run and then crash every claim that reaches it.
 */
function wellFormed(node: unknown, depth: number, budget: { left: number }): boolean {
  if (--budget.left < 0 || depth > MAX_DEPTH) return false;
  if (typeof node === 'string') return !UNSAFE.test(node);
  if (node === null || typeof node === 'number' || typeof node === 'boolean') return true;
  if (Array.isArray(node)) return node.every((n) => wellFormed(n, depth + 1, budget));
  if (typeof node !== 'object') return false;
  const keys = Object.keys(node);
  const op = keys[0];
  if (keys.length !== 1 || op === undefined || !OPERATORS.has(op)) return false;
  const arg = (node as Record<string, unknown>)[op];
  if (op === 'var') {
    const path = Array.isArray(arg) ? arg[0] : arg;
    if (typeof path !== 'number' && !(typeof path === 'string' && VAR_PATH.test(path)))
      return false;
  }
  return wellFormed(arg, depth + 1, budget);
}

/** Rules are data, never code: a closed operator list, bounded size, plain fact paths — then a dry run on empty facts. */
function isKnownLogic(logic: unknown): boolean {
  if (!wellFormed(logic, 0, { left: MAX_NODES }) || !jsonLogic.is_logic(logic)) return false;
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

/** A clause that is malformed or throws on these facts has not been met: the claim goes to a human, it never crashes. */
function clausePasses(logic: unknown, facts: Facts): boolean {
  if (!wellFormed(logic, 0, { left: MAX_NODES })) return false;
  try {
    return jsonLogic.apply(logic as RulesLogic, facts) === true;
  } catch {
    return false;
  }
}

/**
 * Evaluate every clause (not short-circuited) so the explanation can list each one.
 * No clauses means no rule to be eligible under, so an empty rule never makes anyone eligible.
 */
export function evaluateRules(
  clauses: Clause[],
  facts: Facts,
): { eligible: boolean; results: ClauseResult[] } {
  const list = Array.isArray(clauses) ? clauses : [];
  const results = list.map((c) => ({
    id: String(c?.id ?? ''),
    passed: clausePasses(c?.logic, facts),
  }));
  return { eligible: results.length > 0 && results.every((r) => r.passed), results };
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
