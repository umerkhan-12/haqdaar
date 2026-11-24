import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COSTS } from '@haqdaar/shared';
import { SAHARA_V1, type Clause } from '../engine/rules';
import { clauseTextProblems, CostBody, logicNumbers, textNumbers } from './rule-checks';

const lowIncome = SAHARA_V1.clauses.find((c) => c.id === 'low_income')!;
const vulnerable = SAHARA_V1.clauses.find((c) => c.id === 'vulnerable')!;
const withLimit = (c: Clause, from: number, to: number): Clause => ({
  ...c,
  logic: JSON.parse(JSON.stringify(c.logic).replace(String(from), String(to))),
});

test('numbers are read from logic (not fact paths) and from texts (digits, separators, words)', () => {
  assert.deepEqual(logicNumbers(vulnerable.logic), [5]);
  assert.deepEqual(logicNumbers({ '<': [{ var: ['household.size', 3] }, 7] }), [7]);
  assert.deepEqual(textNumbers('Monthly household income is below PKR 40,000.'), [40_000]);
  assert.deepEqual(textNumbers('آمدن ۴۰٬۰۰۰ روپے سے کم'), [40_000]);
  assert.deepEqual(textNumbers('five or more members'), [5]);
});

test('the seeded rule texts agree with its logic', () => {
  assert.deepEqual(clauseTextProblems(SAHARA_V1.clauses, SAHARA_V1.clauses), []);
});

test('a changed limit with the old English text is refused', () => {
  const edited = withLimit(lowIncome, 40_000, 30_000);
  const problems = clauseTextProblems([edited], SAHARA_V1.clauses);
  assert.equal(problems.length, 2);
  assert.match(problems[0]!, /English text says 40,000 but the rule uses 30,000/);
  assert.match(problems[1]!, /update the Urdu text too/);
});

test('a changed limit with both texts updated is accepted', () => {
  const edited = {
    ...withLimit(vulnerable, 5, 8),
    textEn: 'The applicant is a widow or the household has 8 or more members',
    textUr: 'درخواست گزار بیوہ ہیں یا گھر میں آٹھ یا زیادہ افراد ہیں',
  };
  assert.deepEqual(clauseTextProblems([edited], SAHARA_V1.clauses), []);
});

test('an Urdu text written with digits must carry the same numbers', () => {
  const edited = { ...lowIncome, textUr: 'گھر کی ماہانہ آمدن ۳۰۰۰۰ روپے سے کم ہے' };
  assert.match(clauseTextProblems([edited])[0]!, /Urdu text says 30,000 but the rule uses 40,000/);
});

test('costs that give an auto-approve threshold below the floor are refused', () => {
  assert.equal(CostBody.safeParse(DEFAULT_COSTS).success, true);
  const weak = CostBody.safeParse({ wrongApproval: 301, humanReview: 300, askMore: 150 });
  assert.equal(weak.success, false);
  assert.match(weak.error!.issues[0]!.message, /0\.003.*0\.9 or more/);
  assert.equal(
    CostBody.safeParse({ wrongApproval: 25_000.5, humanReview: 300, askMore: 150 }).success,
    false,
  );
});
