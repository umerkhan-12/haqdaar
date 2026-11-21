/**
 * Property tests for rules-as-data: hostile or malformed JSON Logic is rejected or evaluated safely —
 * it never crashes a claim, never runs code, never pollutes prototypes — and valid rules mean what they say.
 * Replay a failure with PROP_SEED=<seed printed in the failure> PROP_RUNS=1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Clause, evaluateRules, RuleDefinition, SAHARA_V1, type Facts } from './rules';

const SEED = Number(process.env.PROP_SEED ?? 20261121);
const RUNS = Number(process.env.PROP_RUNS ?? 2500);

/** mulberry32: a tiny seeded PRNG, so a failing case is reproducible from its seed alone. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    bool: (p = 0.5) => next() < p,
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
  };
}
type Rng = ReturnType<typeof rng>;

function forAll<T>(
  name: string,
  gen: (r: Rng) => T,
  check: (x: T, r: Rng) => void,
  runs = RUNS,
): void {
  test(`${name} [${runs} cases, seed ${SEED}]`, () => {
    for (let i = 0; i < runs; i++) {
      const r = rng(SEED + i);
      const x = gen(r);
      try {
        check(x, r);
      } catch (e) {
        let shown: string;
        try {
          shown = JSON.stringify(x).slice(0, 1200);
        } catch {
          shown = '(too deep to print)';
        }
        throw new Error(
          `${name}: failed at case ${i}. Replay with PROP_SEED=${SEED + i} PROP_RUNS=1\ninput: ${shown}\n${(e as Error).message}`,
        );
      }
    }
  });
}

const VARS = [
  'nadra.match',
  'nadra.deceased',
  'nadra.maritalStatus',
  'nadra.gender',
  'nadra.district',
  'nadra.nameScore',
  'household.householdSize',
  'household.monthlyIncomePkr',
  'household.district',
  'household.pmtScore',
  'claim.fullName',
  'claim.district',
  'claim.householdSize',
  'claim.isWidow',
];
const HOSTILE_VARS = [
  '__proto__',
  'constructor',
  'constructor.constructor',
  '__proto__.polluted',
  'claim.fullName.constructor.constructor',
  'claim.__proto__.x',
  'toString',
  '',
  '.',
  'a'.repeat(5000),
  'nadra..match',
  'household.householdSize.toFixed',
];
const KNOWN_OPS = [
  '==',
  '===',
  '!=',
  '!==',
  '<',
  '<=',
  '>',
  '>=',
  '!',
  '!!',
  'and',
  'or',
  'if',
  'in',
  'cat',
  '+',
  '-',
  '*',
  '/',
  '%',
  'min',
  'max',
  'substr',
  'merge',
  'missing',
  'missing_some',
  'some',
  'all',
  'none',
  'map',
  'filter',
  'reduce',
  'var',
];
const HOSTILE_OPS = [
  'eval',
  'method',
  'exec',
  'require',
  'process.exit',
  'Function',
  'constructor',
  '__proto__',
  'prototype',
  'toString',
  'hasOwnProperty',
  'valueOf',
  'import',
  'var.constructor',
  'log',
  '',
  ' ',
  'and.or',
  '$where',
  '$ne',
  'cat.constructor',
];

function genFacts(r: Rng): Facts {
  return {
    claim: {
      fullName: r.pick(['Zainab Bibi', '', '__proto__']),
      district: r.pick([null, 'Thatta']),
      householdSize: r.pick([null, 5]),
      isWidow: r.pick([null, true, false]),
    },
    nadra: r.bool(0.1)
      ? null
      : {
          match: r.bool(0.8),
          nameScore: r.next(),
          deceased: r.bool(0.2),
          maritalStatus: r.pick(['widowed', 'married', 'single']),
          gender: r.pick(['F', 'M']),
          district: r.pick(['Thatta', 'Badin', 'Lahore']),
        },
    household: r.bool(0.1)
      ? null
      : {
          householdSize: r.int(12),
          monthlyIncomePkr: r.int(80_000),
          district: r.pick(['Thatta', 'Badin', 'Lahore']),
          pmtScore: r.int(100),
        },
  };
}

/** Random JSON that looks like logic: known and hostile operators, wrong arities, wrong types, any depth. */
function genHostileLogic(r: Rng, depth = 0): unknown {
  if (depth > 6 || r.bool(0.2)) {
    return r.pick<() => unknown>([
      () => ({ var: r.bool(0.6) ? r.pick(VARS) : r.pick(HOSTILE_VARS) }),
      () => r.pick([0, 1, -1, 5, 40_000, 1e308, 'widowed', 'Thatta', '', true, false, null]),
      () => [r.pick(['Thatta', 5, null]), r.pick(['Badin', {}, []])],
      () => ({ var: [r.pick(HOSTILE_VARS), { var: 'constructor' }] }),
      () => ({ var: r.pick([null, 0, 1.5, [], {}, true]) }),
    ])();
  }
  const op = r.bool(0.75) ? r.pick(KNOWN_OPS) : r.pick(HOSTILE_OPS);
  const args = r.pick<() => unknown>([
    () => Array.from({ length: r.int(4) }, () => genHostileLogic(r, depth + 1)),
    () => genHostileLogic(r, depth + 1),
    () => 'process.exit(1)',
    () => ({ [r.pick(HOSTILE_OPS)]: [genHostileLogic(r, depth + 1)] }),
    () => null,
  ])();
  const node: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  node[op] = args;
  if (r.bool(0.05)) node[r.pick(HOSTILE_OPS)] = [1]; // two keys: not a logic object
  return { ...node };
}

const clauseOf = (logic: unknown) => ({
  id: 'fuzz_clause',
  logic,
  textUr: 'جانچ کی شرط',
  textEn: 'Fuzz clause',
});

declare global {
  // eslint-disable-next-line no-var
  var __haqdaarPwned: number | undefined;
}

forAll(
  'rules: hostile/malformed JSON Logic is rejected or evaluated safely — no crash, no code execution, no prototype pollution',
  (r) => ({ logic: genHostileLogic(r), facts: genFacts(r) }),
  ({ logic, facts }, r) => {
    globalThis.__haqdaarPwned = 0;
    const parsed = Clause.safeParse(clauseOf(logic)); // must not throw
    if (parsed.success) {
      // Whatever the validator lets through must be safe on every fact set, not only on the empty dry run.
      for (const f of [
        facts,
        genFacts(r),
        genFacts(r),
        { claim: facts.claim, nadra: null, household: null },
      ]) {
        const out = evaluateRules([parsed.data], f);
        assert.equal(typeof out.eligible, 'boolean');
        assert.ok(out.results.every((x) => typeof x.passed === 'boolean'));
      }
    }
    // Even a rule that slipped past validation (e.g. an old row in the database) must fail closed, not crash a claim.
    const direct = evaluateRules([clauseOf(logic) as Clause], facts);
    assert.equal(typeof direct.eligible, 'boolean');
    assert.equal(globalThis.__haqdaarPwned, 0, 'rule JSON executed code');
    assert.equal(
      ({} as Record<string, unknown>).polluted,
      undefined,
      'Object.prototype was polluted',
    );
    assert.equal(Object.keys(Object.prototype).length, 0, 'Object.prototype gained keys');
  },
);

test('rules: known code-execution and pollution payloads are rejected by the schema and inert in the evaluator', () => {
  globalThis.__haqdaarPwned = 0;
  const run = 'globalThis.__haqdaarPwned = 1; return true';
  const payloads: unknown[] = [
    { method: [{ method: [{ var: 'constructor.constructor' }, 'call', [null, run]] }, 'call', []] },
    { eval: run },
    { 'constructor.constructor': [run] },
    { var: 'constructor.constructor' },
    { '==': [{ var: '__proto__.polluted' }, null] },
    { and: [{ var: 'nadra.match' }, { eval: run }] },
    { if: [{ var: 'nadra.match' }, { method: ['x', 'constructor', []] }, true] },
    { or: [{ '==': [{ var: 'household.district' }, null] }, { exec: 'rm -rf /' }] },
    JSON.parse('{"__proto__": {"polluted": true}, "==": [1, 1]}'),
    JSON.parse('{"==": [{"var": "claim"}, {"__proto__": {"polluted": true}}]}'),
  ];
  const facts = genFacts(rng(SEED));
  const full: Facts = {
    ...facts,
    nadra: {
      match: true,
      nameScore: 1,
      deceased: false,
      maritalStatus: 'widowed',
      gender: 'F',
      district: 'Thatta',
    },
    household: { householdSize: 5, monthlyIncomePkr: 1, district: 'Thatta', pmtScore: 1 },
  };
  for (const p of payloads) {
    const parsed = Clause.safeParse(clauseOf(p));
    const out = evaluateRules([clauseOf(p) as Clause], full);
    assert.equal(typeof out.eligible, 'boolean');
    assert.equal(out.eligible, false, `hostile rule passed as eligible: ${JSON.stringify(p)}`);
    // Either refused, or what would be stored no longer carries the hostile key (zod drops an own "__proto__").
    const stored = parsed.success ? JSON.stringify(parsed.data.logic) : '';
    assert.ok(
      !/eval|method|exec|constructor|__proto__/.test(stored),
      `schema would store ${stored}`,
    );
  }
  assert.equal(globalThis.__haqdaarPwned, 0);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

forAll(
  'rules: absurdly deep nesting is rejected without a stack overflow',
  (r) => 50 + r.int(30_000),
  (depth) => {
    let logic: unknown = { '==': [1, 1] };
    for (let i = 0; i < depth; i++) logic = i % 2 ? { '!': [logic] } : { and: [true, logic] };
    assert.equal(Clause.safeParse(clauseOf(logic)).success, false, `depth ${depth} accepted`);
    assert.equal(evaluateRules([clauseOf(logic) as Clause], genFacts(rng(depth))).eligible, false);
  },
  60,
);

// ---------- valid rules mean what they say ----------

type Expr =
  | { k: 'cmp'; op: '==' | '<' | '>=' | '!='; path: string; value: number | string | boolean }
  | { k: 'in'; path: string; values: string[] }
  | { k: 'and' | 'or'; items: Expr[] }
  | { k: 'not'; item: Expr };

function genExpr(r: Rng, depth = 0): Expr {
  if (depth > 3 || r.bool(0.35)) {
    return r.pick<() => Expr>([
      () => ({
        k: 'cmp',
        op: r.pick(['<', '>=']),
        path: r.pick([
          'household.householdSize',
          'household.monthlyIncomePkr',
          'household.pmtScore',
        ]),
        value: r.int(60_000),
      }),
      () => ({
        k: 'cmp',
        op: r.pick(['==', '!=']),
        path: 'nadra.maritalStatus',
        value: r.pick(['widowed', 'married', 'single']),
      }),
      () => ({
        k: 'cmp',
        op: r.pick(['==', '!=']),
        path: r.pick(['nadra.deceased', 'nadra.match']),
        value: r.bool(),
      }),
      () => ({
        k: 'in',
        path: r.pick(['household.district', 'nadra.district']),
        values: r.bool() ? ['Thatta', 'Badin'] : ['Lahore'],
      }),
    ])();
  }
  return r.pick<() => Expr>([
    () => ({ k: 'and', items: Array.from({ length: 1 + r.int(3) }, () => genExpr(r, depth + 1)) }),
    () => ({ k: 'or', items: Array.from({ length: 1 + r.int(3) }, () => genExpr(r, depth + 1)) }),
    () => ({ k: 'not', item: genExpr(r, depth + 1) }),
  ])();
}

const toLogic = (e: Expr): Record<string, unknown> =>
  e.k === 'cmp'
    ? { [e.op]: [{ var: e.path }, e.value] }
    : e.k === 'in'
      ? { in: [{ var: e.path }, e.values] }
      : e.k === 'not'
        ? { '!': [toLogic(e.item)] }
        : { [e.k]: e.items.map(toLogic) };

const lookup = (f: Facts, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], f);
/** The same expression evaluated in plain TypeScript: the oracle JSON Logic is compared against. */
function truth(e: Expr, f: Facts): boolean {
  switch (e.k) {
    case 'cmp': {
      const v = lookup(f, e.path) as number | string | boolean;
      return e.op === '=='
        ? v === e.value
        : e.op === '!='
          ? v !== e.value
          : e.op === '<'
            ? v < e.value
            : v >= e.value;
    }
    case 'in':
      return e.values.includes(lookup(f, e.path) as string);
    case 'and':
      return e.items.every((x) => truth(x, f));
    case 'or':
      return e.items.some((x) => truth(x, f));
    case 'not':
      return !truth(e.item, f);
  }
}

forAll(
  'rules: a generated valid rule is accepted and evaluates exactly like the same rule written in TypeScript',
  (r) => {
    const facts = genFacts(r);
    facts.nadra ??= {
      match: true,
      nameScore: 1,
      deceased: false,
      maritalStatus: 'widowed',
      gender: 'F',
      district: 'Thatta',
    };
    facts.household ??= {
      householdSize: 5,
      monthlyIncomePkr: 18_000,
      district: 'Thatta',
      pmtScore: 18,
    };
    return { exprs: Array.from({ length: 1 + r.int(4) }, () => genExpr(r)), facts };
  },
  ({ exprs, facts }) => {
    const clauses = exprs.map((e, i) =>
      Clause.parse({ id: `c_${i}`, logic: toLogic(e), textUr: 'شرط', textEn: 'clause' }),
    );
    const out = evaluateRules(clauses, facts);
    assert.deepEqual(
      out.results.map((x) => x.passed),
      exprs.map((e) => truth(e, facts)),
    );
    assert.equal(
      out.eligible,
      exprs.every((e) => truth(e, facts)),
    );
    assert.equal(
      out.results.length,
      clauses.length,
      'every clause is reported (not short-circuited)',
    );
  },
);

forAll(
  'rules: a rule definition with a bad amount, no clauses or too many clauses is rejected',
  (r) =>
    r.pick([
      { ...SAHARA_V1, amount: r.pick([0, -1, -12_000, 100_001, 1e9, 0.5, NaN, Infinity]) },
      { ...SAHARA_V1, clauses: [] },
      {
        ...SAHARA_V1,
        clauses: Array.from({ length: 21 + r.int(30) }, (_, i) => ({
          ...SAHARA_V1.clauses[0]!,
          id: `c_${i}`,
        })),
      },
      {
        ...SAHARA_V1,
        clauses: [
          {
            ...SAHARA_V1.clauses[0]!,
            id: r.pick(['', 'A', '1abc', 'has space', '__proto__', 'x'.repeat(60)]),
          },
        ],
      },
      {
        ...SAHARA_V1,
        clauses: [{ ...SAHARA_V1.clauses[0]!, textUr: r.pick(['', 'x', 'y'.repeat(201)]) }],
      },
      { ...SAHARA_V1, amount: '12000' },
      { ...SAHARA_V1, clauses: 'all' },
    ]),
  (def) => {
    assert.equal(RuleDefinition.safeParse(def).success, false);
  },
  500,
);

test('rules: the seeded Sahara v1 rule passes its own schema', () => {
  assert.equal(RuleDefinition.safeParse(SAHARA_V1).success, true);
});
