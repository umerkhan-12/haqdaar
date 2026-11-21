/**
 * Property tests for the money path: random event sequences never reach an illegal payment state, never
 * pay twice for one idempotency key, and the double-entry ledger balances after every single step.
 * The stateful service needs Postgres, so the sequences run against a small in-memory model that uses the
 * SAME pure functions the service uses (transition guard, ledger lines, end-to-end ids).
 * Replay a failure with PROP_SEED=<seed printed in the failure> PROP_RUNS=1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAYMENT_TRANSITIONS, PaymentState } from '@haqdaar/shared';
import {
  assertBalanced,
  deriveBalances,
  payoutLines,
  reversalLines,
  ACCOUNTS,
  type LedgerLine,
} from './ledger';
import { nameMatchScore, TITLE_MATCH_THRESHOLD } from './name-match';
import { newEndToEndId, transitionError } from './transition';
import { DEFAULT_VELOCITY, velocityBreached, type RecentPayout } from './velocity';
import { backoffMs, signWebhook, verifyWebhook } from './webhook-signature';
import { reconcile, type OurPayout, type ProviderEntry } from '../reconciliation/reconcile';
import { amountInWords, receiptText } from '../receipts/receipt';

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

function sweep<T>(
  gen: (r: Rng) => T,
  check: (x: T, r: Rng) => void,
): { failed: number; first: string[] } {
  let failed = 0;
  const first: string[] = [];
  for (let i = 0; i < RUNS; i++) {
    const r = rng(SEED + i);
    const x = gen(r);
    try {
      check(x, r);
    } catch (e) {
      failed++;
      if (first.length < 3)
        first.push(
          `PROP_SEED=${SEED + i} PROP_RUNS=1 input=${JSON.stringify(x).slice(0, 400)} → ${(e as Error).message}`,
        );
    }
  }
  return { failed, first };
}

function forAll<T>(
  name: string,
  gen: (r: Rng) => T,
  check: (x: T, r: Rng) => void,
  opts: { todo?: string } = {},
): void {
  test(`${name} [${RUNS} cases, seed ${SEED}]`, opts, () => {
    const { failed, first } = sweep(gen, check);
    assert.equal(
      failed,
      0,
      `${name}: ${failed}/${RUNS} generated cases failed. First:\n${first.join('\n')}`,
    );
  });
}

const STATES = PaymentState.options;

// ---------- state machine: the transition table itself ----------

test('state machine: structural safety of the transition table (exhaustive)', () => {
  const reach = (from: PaymentState): Set<PaymentState> => {
    const seen = new Set<PaymentState>();
    const todo = [...PAYMENT_TRANSITIONS[from]];
    while (todo.length) {
      const s = todo.pop()!;
      if (seen.has(s)) continue;
      seen.add(s);
      todo.push(...PAYMENT_TRANSITIONS[s]);
    }
    return seen;
  };
  for (const s of STATES)
    assert.ok(s === 'CREATED' || reach('CREATED').has(s), `${s} is unreachable`);
  assert.deepEqual([...PAYMENT_TRANSITIONS.REVERSED], [], 'REVERSED must be terminal');
  for (const s of STATES)
    assert.ok(!PAYMENT_TRANSITIONS[s].includes('CREATED'), `${s} can go back to CREATED`);
  // No blind resend: "we do not know" must first be resolved to a confirmed FAILED; once it arrived, never again.
  assert.ok(
    !PAYMENT_TRANSITIONS.UNKNOWN.includes('SENT'),
    'UNKNOWN → SENT is a blind resend (double payment)',
  );
  assert.ok(!reach('SUCCESS').has('SENT'), 'SUCCESS can reach SENT again (double payment)');
  // Money only leaves through SENT, and only after a human-or-policy approval step.
  for (const s of STATES)
    if (PAYMENT_TRANSITIONS[s].includes('SENT'))
      assert.ok(s === 'APPROVED' || s === 'FAILED', `${s} → SENT skips approval`);
  for (const s of STATES)
    if (PAYMENT_TRANSITIONS[s].includes('SUCCESS'))
      assert.ok(['SENT', 'UNKNOWN', 'REVERSAL_REQUESTED'].includes(s));
  for (const a of STATES)
    for (const b of STATES)
      assert.equal(transitionError(a, b) === null, PAYMENT_TRANSITIONS[a].includes(b));
});

// ---------- model: payments + ledger driven by random events ----------

interface ModelPayment {
  key: string;
  amount: number;
  state: PaymentState;
  endToEndId: string;
  history: PaymentState[];
  payoutGroups: number;
  reversalGroups: number;
}

/** What the service does, without the database: idempotent create, guarded transition, ledger in the same step. */
class Model {
  readonly byKey = new Map<string, ModelPayment>();
  readonly ledger: LedgerLine[] = [];

  create(caseId: string, amount: number): ModelPayment {
    const key = `case:${caseId}`;
    const existing = this.byKey.get(key);
    if (existing) return existing;
    const p: ModelPayment = {
      key,
      amount,
      state: 'CREATED',
      endToEndId: newEndToEndId(),
      history: ['CREATED'],
      payoutGroups: 0,
      reversalGroups: 0,
    };
    this.byKey.set(key, p);
    return p;
  }

  /** Returns false when the guard refuses; the payment is then untouched. */
  transition(p: ModelPayment, to: PaymentState): boolean {
    if (transitionError(p.state, to)) return false;
    if (to === 'SUCCESS' && p.state !== 'REVERSAL_REQUESTED') {
      this.ledger.push(...payoutLines(p.amount));
      p.payoutGroups++;
    }
    if (to === 'REVERSED') {
      this.ledger.push(...reversalLines(p.amount));
      p.reversalGroups++;
    }
    p.state = to;
    p.history.push(to);
    return true;
  }
}

const sum = (lines: LedgerLine[], d: 'DEBIT' | 'CREDIT') =>
  lines.filter((l) => l.direction === d).reduce((s, l) => s + l.amount, 0);

forAll(
  'payments: random event sequences never reach an illegal state, never pay twice per idempotency key, ledger debits == credits after every step',
  (r) => ({
    events: Array.from({ length: 5 + r.int(80) }, () => ({
      caseId: `c${r.int(6)}`,
      amount: 1 + r.int(100_000),
      to: r.bool(0.75) ? null : r.pick(STATES),
      legal: r.bool(0.7),
    })),
  }),
  ({ events }, r) => {
    const m = new Model();
    for (const e of events) {
      const first = m.byKey.get(`case:${e.caseId}`);
      const p = m.create(e.caseId, e.amount);
      if (first) assert.equal(p, first, 'same idempotency key created a second payment');
      const before = p.state;
      const options = PAYMENT_TRANSITIONS[p.state];
      const to = e.to ?? (e.legal && options.length ? r.pick(options) : r.pick(STATES));
      const moved = m.transition(p, to);
      assert.equal(moved, PAYMENT_TRANSITIONS[before].includes(to));
      if (!moved) assert.equal(p.state, before, 'a refused transition changed the state');

      assert.ok(STATES.includes(p.state));
      assert.equal(sum(m.ledger, 'DEBIT'), sum(m.ledger, 'CREDIT'), 'ledger debits != credits');
      assert.equal(
        deriveBalances(m.ledger).reduce((s, b) => s + b.balance, 0),
        0,
      );
    }
    let outstanding = 0;
    for (const p of m.byKey.values()) {
      assert.ok(
        p.payoutGroups <= 1,
        `${p.key} was paid ${p.payoutGroups} times: ${p.history.join('→')}`,
      );
      assert.ok(
        p.reversalGroups <= p.payoutGroups,
        `${p.key} reversed without a payout: ${p.history.join('→')}`,
      );
      assert.equal(
        p.payoutGroups === 1,
        p.history.includes('SUCCESS'),
        'ledger and state disagree about the payout',
      );
      assert.equal(
        p.history.filter((s) => s === 'SENT').length <= 1 || p.history.includes('FAILED'),
        true,
        're-sent without a confirmed failure',
      );
      for (let i = 1; i < p.history.length; i++)
        assert.ok(PAYMENT_TRANSITIONS[p.history[i - 1]!].includes(p.history[i]!));
      assert.ok(p.endToEndId.length <= 35);
      outstanding += (p.payoutGroups - p.reversalGroups) * p.amount;
    }
    const fund = deriveBalances(m.ledger).find((b) => b.account === ACCOUNTS.programFund);
    assert.equal(
      (fund?.balance ?? 0) + outstanding,
      0,
      'program fund does not equal payouts minus reversals',
    );
    assert.equal(
      new Set([...m.byKey.values()].map((p) => p.endToEndId)).size,
      m.byKey.size,
      'end-to-end ids collide',
    );
  },
);

// ---------- ledger ----------

forAll(
  'ledger: only positive whole amounts are booked; a payout and its reversal cancel exactly',
  (r) =>
    r.pick([
      1,
      12_000,
      1 + r.int(10_000_000),
      0,
      -1,
      -12_000,
      0.5,
      12_000.01,
      NaN,
      Infinity,
      -Infinity,
    ]),
  (amount) => {
    const valid = Number.isInteger(amount) && amount > 0;
    if (!valid) {
      assert.throws(() => payoutLines(amount));
      assert.throws(() => reversalLines(amount));
      return;
    }
    const all = [...payoutLines(amount), ...reversalLines(amount)];
    assert.ok(deriveBalances(all).every((b) => b.balance === 0));
    assert.ok(deriveBalances(payoutLines(amount)).every((b) => Math.abs(b.balance) === amount));
  },
);

forAll(
  'ledger: an unbalanced or one-sided entry group is always refused',
  (r) => {
    const lines: LedgerLine[] = Array.from({ length: r.int(5) }, () => ({
      account: r.pick(['a', 'b', 'c']),
      direction: r.pick(['DEBIT', 'CREDIT'] as const),
      amount: r.pick([1, 5, 12_000, 0, -5, 2.5]),
    }));
    return lines;
  },
  (lines) => {
    const net = lines.reduce((s, l) => s + (l.direction === 'DEBIT' ? l.amount : -l.amount), 0);
    const ok =
      lines.length >= 2 &&
      net === 0 &&
      lines.every((l) => Number.isInteger(l.amount) && l.amount > 0);
    if (ok) assert.equal(assertBalanced(lines), lines);
    else assert.throws(() => assertBalanced(lines));
  },
);

// ---------- velocity (mule accounts) ----------

forAll(
  'velocity: own payouts and old payouts never count; more payouts to other people never clear a hold',
  (r) => {
    const now = new Date('2026-11-21T12:00:00Z');
    const recent: RecentPayout[] = Array.from({ length: r.int(8) }, () => ({
      personId: r.pick(['me', 'p1', 'p2', 'p3']),
      createdAt: new Date(now.getTime() - r.int(48 * 3_600_000)),
    }));
    return {
      now,
      recent,
      extra: {
        personId: r.pick(['p4', 'p5']),
        createdAt: new Date(now.getTime() - r.int(48 * 3_600_000)),
      },
    };
  },
  ({ now, recent, extra }) => {
    const since = now.getTime() - DEFAULT_VELOCITY.windowMs;
    const others = new Set(
      recent
        .filter((p) => p.personId !== 'me' && p.createdAt.getTime() >= since)
        .map((p) => p.personId),
    );
    const breached = velocityBreached('me', recent, now);
    assert.equal(breached, others.size >= DEFAULT_VELOCITY.maxOtherPersons);
    if (breached) assert.equal(velocityBreached('me', [...recent, extra], now), true);
    assert.equal(
      velocityBreached(
        'me',
        recent.filter((p) => p.personId === 'me'),
        now,
      ),
      false,
    );
  },
);

// ---------- reconciliation ----------

forAll(
  'reconciliation: every payout and every settled provider line is accounted for exactly once',
  (r) => {
    const ids = Array.from({ length: 1 + r.int(8) }, (_, i) => `HQ${i}`);
    const ours: OurPayout[] = ids
      .filter(() => r.bool(0.8))
      .map((id) => ({ endToEndId: id, amount: 12_000, paymentId: `pay-${id}` }));
    const provider: ProviderEntry[] = [];
    for (const id of [...ids, 'GHOST1']) {
      for (let k = r.pick([0, 1, 1, 1, 2, 3]); k > 0; k--)
        provider.push({
          endToEndId: id,
          amount: r.bool(0.85) ? 12_000 : 11_000,
          status: r.bool(0.85) ? 'ACSC' : 'RJCT',
        });
    }
    return { ours, provider };
  },
  ({ ours, provider }) => {
    const items = reconcile(ours, provider);
    const settled = provider.filter((p) => p.status === 'ACSC');
    const primary = items.filter((i) => i.status !== 'duplicate_in_provider');
    const ids = new Set([...ours.map((o) => o.endToEndId), ...settled.map((p) => p.endToEndId)]);
    assert.equal(primary.length, ids.size, 'an id is missing or listed twice');
    assert.equal(new Set(primary.map((i) => i.endToEndId)).size, ids.size);
    const extras = [...ids].reduce(
      (n, id) => n + Math.max(0, settled.filter((p) => p.endToEndId === id).length - 1),
      0,
    );
    assert.equal(items.length, ids.size + extras, 'duplicate settlements are not all listed');
    for (const o of ours) {
      const lines = settled.filter((p) => p.endToEndId === o.endToEndId);
      const item = primary.find((i) => i.endToEndId === o.endToEndId)!;
      assert.equal(
        item.status,
        !lines.length
          ? 'missing_in_provider'
          : lines[0]!.amount !== o.amount
            ? 'amount_mismatch'
            : 'matched',
      );
      assert.equal(
        items.filter((i) => i.endToEndId === o.endToEndId && i.status === 'duplicate_in_provider')
          .length,
        Math.max(0, lines.length - 1),
        'a double settlement was not flagged',
      );
    }
    for (const i of primary.filter((x) => x.paymentId === null))
      assert.equal(i.status, 'missing_in_ledger');
  },
);

// ---------- webhook signatures ----------

forAll(
  'webhooks: a signed body verifies; any single-character change of body or signature, a wrong secret or an old timestamp fails',
  (r) => ({
    body: JSON.stringify({
      type: 'payments.payment.state_changed',
      paymentId: `p${r.int(1e6)}`,
      amount: 1 + r.int(50_000),
      note: r.pick(['', 'زینب', 'a=b,c', 't=1,v1=00']),
    }),
    secret: `whsec_${r.int(1e9).toString(36)}`,
    t: 1_700_000_000 + r.int(1e6),
  }),
  ({ body, secret, t }, r) => {
    const header = signWebhook(body, secret, t);
    assert.equal(verifyWebhook(header, body, secret, 300, t + r.int(300)), true);
    const at = r.int(body.length);
    const tampered = body.slice(0, at) + (body[at] === 'x' ? 'y' : 'x') + body.slice(at + 1);
    assert.equal(verifyWebhook(header, tampered, secret, 300, t), false, 'tampered body accepted');
    const h = 5 + String(t).length + r.int(64);
    const badHeader = header.slice(0, h) + (header[h] === '0' ? '1' : '0') + header.slice(h + 1);
    assert.equal(
      verifyWebhook(badHeader, body, secret, 300, t),
      false,
      'tampered signature accepted',
    );
    assert.equal(verifyWebhook(header, body, `${secret}x`, 300, t), false);
    assert.equal(
      verifyWebhook(header, body, secret, 300, t + 301 + r.int(1e6)),
      false,
      'replayed old webhook accepted',
    );
  },
);

forAll(
  'webhooks: junk signature headers are refused without throwing; retry backoff only grows',
  (r) =>
    r.pick([
      '',
      ',',
      '=',
      't=',
      'v1=',
      't=abc,v1=00',
      '__proto__=1,v1=x',
      't=1,t=2,v1=,v1=',
      'x'.repeat(10_000),
      't=NaN,v1=NaN',
      't=1e99,v1=00',
      't=-1,v1=',
      ',,,,',
    ]),
  (header, r) => {
    assert.equal(verifyWebhook(header, '{}', 'secret', 300, 1_700_000_000), false);
    const n = r.int(30);
    assert.ok(backoffMs(n + 1) >= backoffMs(n) && backoffMs(n) >= 10_000);
  },
);

// ---------- receipt text ----------

forAll(
  'receipt: the amount is always written in digits and in words, never as junk',
  (r) => r.pick([12_000, 12_500, 25_000, 1 + r.int(100_000), 1000 * (1 + r.int(100))]),
  (amount) => {
    const words = amountInWords(amount);
    assert.ok(words.length > 0 && !/undefined|NaN|null/.test(words), `words: "${words}"`);
    const text = receiptText(amount, amount % 2 ? `RAAST-${amount}` : null);
    assert.ok(text.includes(amount.toLocaleString('en-PK')), 'digits missing');
    assert.ok(text.includes(words), 'words missing');
    assert.ok(!/undefined|NaN/.test(text));
  },
);

// ---------- account title vs beneficiary (mule detection) ----------

const FEMALE = [
  'Zainab',
  'Rashida',
  'Nasreen',
  'Shazia',
  'Parveen',
  'Kausar',
  'Shamim',
  'Fatima',
  'Ayesha',
  'Kaneez',
  'Sakina',
  'Rukhsana',
  'Tahira',
  'Bushra',
  'Naheed',
  'Khadija',
  'Maryam',
  'Sughra',
  'Zubaida',
  'Hajra',
  'Gulshan',
  'Salma',
  'Najma',
  'Hameeda',
  'Jameela',
  'Rehana',
  'Nusrat',
  'Mumtaz',
  'Yasmeen',
];
const HONORIFIC = ['Bibi', 'Begum', 'Khatoon'];

forAll(
  "title match: the beneficiary's own account title (any case, order, Muhammad/Begum spelling) matches",
  (r) => {
    const name = r.bool(0.7)
      ? `${r.pick(FEMALE)} ${r.pick(HONORIFIC)}`
      : `Muhammad ${r.pick(['Aslam', 'Akram', 'Iqbal', 'Hussain'])}`;
    const title = r.pick<(s: string) => string>([
      (s) => s.toUpperCase(),
      (s) => s.split(' ').reverse().join(' ').toUpperCase(),
      (s) =>
        s
          .replace('Muhammad', r.pick(['MOHD', 'Mohammad', 'MUHAMMED', 'Md.']))
          .replace('Begum', 'BEGAM')
          .replace('Khatoon', 'Khatun'),
      (s) => `  ${s.replace(' ', '   ')}.`,
    ])(name);
    return { name, title };
  },
  ({ name, title }) => {
    assert.ok(
      nameMatchScore(name, title) >= TITLE_MATCH_THRESHOLD,
      `${name} vs ${title} → ${nameMatchScore(name, title)}`,
    );
    assert.equal(nameMatchScore(name, title), nameMatchScore(title, name));
  },
);

forAll(
  "title match: an account in ANOTHER person's name never passes, even when both names end in Bibi/Begum/Khatoon",
  (r) => {
    const i = r.int(FEMALE.length);
    const j = (i + 1 + r.int(FEMALE.length - 1)) % FEMALE.length;
    const h = r.pick(HONORIFIC);
    return { name: `${FEMALE[i]} ${h}`, title: `${FEMALE[j]} ${h}`.toUpperCase() };
  },
  ({ name, title }) => {
    const s = nameMatchScore(name, title);
    assert.ok(s < TITLE_MATCH_THRESHOLD, `${name} vs ${title} → ${s} ≥ ${TITLE_MATCH_THRESHOLD}`);
  },
);

test('title match: never throws on hostile strings and an empty title never matches', () => {
  for (const s of ['', ' ', '123', 'زینب بی بی', '👩‍👧‍👦', 'x'.repeat(50_000), "'; DROP TABLE--"]) {
    assert.equal(nameMatchScore(s, ''), 0);
    assert.ok(nameMatchScore(s, 'ZAINAB BIBI') < TITLE_MATCH_THRESHOLD);
  }
});
