import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COSTS } from '@haqdaar/shared';
import { confidenceScore, decide, type DecisionInputs, type DecisionContext } from './decide';
import { nameSimilarity, normalizeName } from './names';
import { priority } from './priority';
import { Clause, evaluateRules, SAHARA_V1, type Facts } from './rules';

const zainabFacts: Facts = {
  claim: { fullName: 'Zainab Bibi', district: 'Thatta', householdSize: 5, isWidow: true },
  nadra: {
    match: true,
    nameScore: 1,
    deceased: false,
    maritalStatus: 'widowed',
    gender: 'F',
    district: 'Thatta',
  },
  household: { householdSize: 5, monthlyIncomePkr: 18_000, district: 'Thatta', pmtScore: 18 },
};

const strong: DecisionInputs = {
  facts: zainabFacts,
  evidence: {
    nadraMatch: true,
    nameScore: 1,
    householdVerified: true,
    extractionConfidence: null,
    possibleDuplicate: false,
  },
  externalFlags: [],
  missing: [],
};

const ctx: DecisionContext = {
  clauses: SAHARA_V1.clauses,
  amount: 12_000,
  costs: DEFAULT_COSTS,
  amountCap: 15_000,
};

// ---------- names (challenge 03) ----------

test('Muhammad spelling variants and titles normalise to the same name', () => {
  assert.equal(normalizeName('Muhammad Aslam'), 'mhd aslam');
  assert.equal(normalizeName('Mohd. Aslam'), 'mhd aslam');
  assert.equal(normalizeName('Haji Mohammed  ASLAM'), 'mhd aslam');
});

test('Urdu script matches its Latin spelling', () => {
  assert.equal(nameSimilarity('زینب بی بی', 'Zainab Bibi'), 1);
  assert.equal(nameSimilarity('محمد اسلم', 'Muhammad Aslam'), 1);
});

test('spelling variants and word order score high; different people score low', () => {
  assert.ok(nameSimilarity('Zaynab Bibi', 'Zainab') > 0.95);
  assert.ok(nameSimilarity('Aslam Muhammad', 'Muhammad Aslam') > 0.99);
  assert.ok(nameSimilarity('Nasrin Parvin', 'Nasreen Perveen') > 0.95);
  assert.ok(nameSimilarity('Zainab Bibi', 'Rashida Begum') < 0.7);
});

// ---------- rules ----------

test('Sahara v1: Zainab is eligible on every clause', () => {
  const r = evaluateRules(SAHARA_V1.clauses, zainabFacts);
  assert.equal(r.eligible, true);
  assert.equal(r.results.length, 4);
});

test('Sahara v1: high income fails only the income clause', () => {
  const facts = {
    ...zainabFacts,
    household: { ...zainabFacts.household!, monthlyIncomePkr: 55_000 },
  };
  const r = evaluateRules(SAHARA_V1.clauses, facts);
  assert.equal(r.eligible, false);
  assert.deepEqual(
    r.results.filter((x) => !x.passed).map((x) => x.id),
    ['low_income'],
  );
});

test('rule clauses with unknown operators are rejected', () => {
  const bad = { id: 'x1', logic: { eval: 'process.exit()' }, textUr: 'aa', textEn: 'aa' };
  assert.equal(Clause.safeParse(bad).success, false);
  assert.equal(Clause.safeParse(SAHARA_V1.clauses[0]).success, true);
});

// ---------- decisions (challenges 01, 02, 05) ----------

test('cost model threshold is 0.988 and strong evidence clears it', () => {
  const d = decide(strong, ctx);
  assert.equal(d.threshold.toFixed(3), '0.988');
  assert.equal(d.lane, 'AUTO_APPROVE');
  assert.ok(d.confidence >= 0.988);
  assert.match(d.explanationEn, /^Approved because: .*program district/);
  assert.match(d.explanationUr, /منظور/);
});

test('ineligible is never auto-rejected: it goes to a human with the failed clause explained', () => {
  const facts = {
    ...zainabFacts,
    household: { ...zainabFacts.household!, monthlyIncomePkr: 55_000 },
  };
  const d = decide({ ...strong, facts }, ctx);
  assert.equal(d.lane, 'HUMAN_REVIEW');
  assert.equal(d.eligible, false);
  assert.match(d.explanationEn, /not met: Monthly household income/);
});

test('hard flags always go to a human, even with eligible facts', () => {
  const deceased = { ...zainabFacts, nadra: { ...zainabFacts.nadra!, deceased: true } };
  assert.equal(decide({ ...strong, facts: deceased }, ctx).lane, 'HUMAN_REVIEW');
  const dup = decide({ ...strong, externalFlags: ['duplicate_claim_this_month'] }, ctx);
  assert.equal(dup.lane, 'HUMAN_REVIEW');
  assert.deepEqual(dup.hardFlags, ['duplicate_claim_this_month']);
  const mismatch = decide({ ...strong, evidence: { ...strong.evidence, nameScore: 0.7 } }, ctx);
  assert.deepEqual(mismatch.hardFlags, ['name_mismatch']);
});

const ANOMALY_FLAGS = [
  'anomaly:shared_payout',
  'anomaly:helper_velocity',
  'anomaly:household_pattern',
  'anomaly:identity_collision',
] as const;
/** Words that would tell a claimant which fraud check fired (English and Urdu). */
const ANOMALY_WORDING =
  /anomal|fraud|ring|payout|account|destination|helper|household size|multiple people|several|identit|collision|same name|ادائیگی|اکاؤنٹ|مددگار|گھرانے|ملتے جلتے|دعوو/i;

test('anomaly flags force human review, but the explanation the citizen reads stays generic', () => {
  const unsure = decide({ ...strong, evidence: { ...strong.evidence, nadraMatch: false } }, ctx);
  assert.equal(unsure.lane, 'HUMAN_REVIEW');
  assert.deepEqual(unsure.hardFlags, []);
  for (const flag of ANOMALY_FLAGS) {
    const d = decide({ ...strong, externalFlags: [flag] }, ctx);
    assert.equal(d.lane, 'HUMAN_REVIEW');
    assert.deepEqual(d.hardFlags, [flag]); // officers still get the flag
    assert.doesNotMatch(d.explanationEn, ANOMALY_WORDING);
    assert.doesNotMatch(d.explanationUr, ANOMALY_WORDING);
    // Word for word what an ordinary "not sure" claim is told: nothing to tell the two apart.
    assert.equal(d.explanationEn, unsure.explanationEn);
    assert.equal(d.explanationUr, unsure.explanationUr);
    assert.equal(
      d.explanationEn,
      'An officer will review this claim: we are not fully sure, so an officer will check.',
    );
  }
  const all = decide({ ...strong, externalFlags: [...ANOMALY_FLAGS] }, ctx);
  assert.equal(all.explanationEn, unsure.explanationEn);
});

test('an anomaly flag next to an ordinary reason adds nothing to the explanation', () => {
  const plain = decide({ ...strong, externalFlags: ['duplicate_claim_this_month'] }, ctx);
  const both = decide(
    { ...strong, externalFlags: ['anomaly:shared_payout', 'duplicate_claim_this_month'] },
    ctx,
  );
  assert.equal(both.explanationEn, plain.explanationEn);
  assert.equal(both.explanationUr, plain.explanationUr);
  assert.deepEqual(both.hardFlags, ['anomaly:shared_payout', 'duplicate_claim_this_month']);

  const facts = {
    ...zainabFacts,
    household: { ...zainabFacts.household!, monthlyIncomePkr: 55_000 },
  };
  const ineligible = decide({ ...strong, facts }, ctx);
  const flagged = decide({ ...strong, facts, externalFlags: ['anomaly:helper_velocity'] }, ctx);
  assert.equal(flagged.explanationEn, ineligible.explanationEn);
  assert.equal(flagged.explanationUr, ineligible.explanationUr);
});

test('a clean claim with no anomaly signal is decided exactly as before', () => {
  const d = decide(strong, ctx);
  assert.equal(d.lane, 'AUTO_APPROVE');
  assert.deepEqual(d.hardFlags, []);
  assert.equal(d.eligible, true);
  assert.equal(d.confidence, confidenceScore(strong.evidence));
  assert.equal(
    d.explanationEn,
    `Approved because: ${SAHARA_V1.clauses.map((c) => c.textEn).join('; ')}.`,
  );
  assert.equal(
    d.explanationUr,
    `آپ کی درخواست منظور ہو گئی کیونکہ: ${SAHARA_V1.clauses.map((c) => c.textUr).join('، ')}۔`,
  );
});

test('missing consent → ASK_MORE with a plain explanation', () => {
  const d = decide({ ...strong, missing: ['consent:household_data'] }, ctx);
  assert.equal(d.lane, 'ASK_MORE');
  assert.match(d.explanationEn, /permission to check household data/);
});

test('unverified household lowers confidence below the threshold → human', () => {
  const p = confidenceScore({ ...strong.evidence, householdVerified: false });
  assert.ok(p < 0.988);
  const d = decide({ ...strong, evidence: { ...strong.evidence, householdVerified: false } }, ctx);
  assert.equal(d.lane, 'HUMAN_REVIEW');
  assert.match(d.explanationEn, /not fully sure/);
});

test('amount above the cap needs an officer even when certain', () => {
  const d = decide(strong, { ...ctx, amount: 20_000 });
  assert.equal(d.lane, 'HUMAN_REVIEW');
  assert.match(d.explanationEn, /officer’s approval/);
});

test('verification services down → human review, never a crash or a guess', () => {
  const d = decide(
    {
      ...strong,
      facts: { ...zainabFacts, nadra: null, household: null },
      externalFlags: ['verification_unavailable'],
    },
    ctx,
  );
  assert.equal(d.lane, 'HUMAN_REVIEW');
  assert.equal(d.eligible, null);
});

test('no input ever produces a rejection lane', () => {
  const lanes = new Set<string>();
  for (const income of [10_000, 90_000])
    for (const deceased of [true, false])
      for (const nameScore of [0.5, 1])
        lanes.add(
          decide(
            {
              ...strong,
              facts: {
                ...zainabFacts,
                nadra: { ...zainabFacts.nadra!, deceased },
                household: { ...zainabFacts.household!, monthlyIncomePkr: income },
              },
              evidence: { ...strong.evidence, nameScore },
            },
            ctx,
          ).lane,
        );
  assert.deepEqual([...lanes].sort(), ['AUTO_APPROVE', 'HUMAN_REVIEW']);
});

// ---------- priority ----------

test('queue priority rises with risk, amount and waiting time', () => {
  const now = new Date('2026-11-21T12:00:00Z');
  const fresh = { confidence: 0.9, hardFlagCount: 0, amount: 12_000, createdAt: now };
  assert.ok(priority({ ...fresh, confidence: 0.4 }, now) > priority(fresh, now));
  assert.ok(priority({ ...fresh, hardFlagCount: 1 }, now) > priority(fresh, now));
  assert.ok(
    priority({ ...fresh, createdAt: new Date('2026-11-20T12:00:00Z') }, now) > priority(fresh, now),
  );
});
