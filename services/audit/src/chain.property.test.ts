/**
 * Property tests for the audit hash chain: an untouched chain always verifies; editing any field of any
 * entry, or deleting / reordering / inserting an entry, is detected at exactly the right sequence number.
 * Replay a failure with PROP_SEED=<seed printed in the failure> PROP_RUNS=1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalJson,
  chainHash,
  GENESIS_HASH,
  verifyRows,
  type ChainFields,
  type ChainRow,
} from './chain';

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

function forAll<T>(name: string, gen: (r: Rng) => T, check: (x: T, r: Rng) => void): void {
  test(`${name} [${RUNS} cases, seed ${SEED}]`, () => {
    for (let i = 0; i < RUNS; i++) {
      const r = rng(SEED + i);
      const x = gen(r);
      try {
        check(x, r);
      } catch (e) {
        throw new Error(
          `${name}: failed at case ${i}. Replay with PROP_SEED=${SEED + i} PROP_RUNS=1\ninput: ${JSON.stringify(x).slice(0, 700)}\n${(e as Error).message}`,
        );
      }
    }
  });
}

const STRINGS = [
  '',
  'Zainab Bibi',
  'زینب بی بی',
  '👩‍👧‍👦',
  '"quoted"',
  'back\\slash',
  'line\nbreak',
  '‮rtl',
  '__proto__',
  'x'.repeat(300),
];
const TYPES = [
  'cases.case.submitted',
  'cases.case.decided',
  'payments.payment.state_changed',
  'identity.consent.granted',
  'ai.call.completed',
];

function genJson(r: Rng, depth = 0): unknown {
  if (depth > 3 || r.bool(0.45))
    return r.pick<() => unknown>([
      () => r.int(1_000_000),
      () => r.next(),
      () => -r.int(50),
      () => r.pick(STRINGS),
      () => r.bool(),
      () => null,
    ])();
  if (r.bool(0.3)) return Array.from({ length: r.int(4) }, () => genJson(r, depth + 1));
  return Object.fromEntries(
    Array.from({ length: r.int(5) }, (_, i) => [
      `${r.pick(['caseId', 'amount', 'lane', 'to', 'from', 'k'])}${i}`,
      genJson(r, depth + 1),
    ]),
  );
}

function genChain(r: Rng, min = 1): ChainRow[] {
  const rows: ChainRow[] = [];
  let prev = GENESIS_HASH;
  const n = min + r.int(12);
  const startSeq = 1 + r.int(1000);
  for (let i = 0; i < n; i++) {
    const fields: ChainFields = {
      eventId: `00000000-0000-4000-8000-${String(r.int(1e9)).padStart(12, '0')}`,
      type: r.pick(TYPES),
      source: r.pick(['cases', 'payments', 'identity', 'ai']),
      tenantId: r.bool(0.2) ? null : `t${r.int(3)}`,
      actor: r.bool(0.2)
        ? null
        : { id: `u${r.int(9)}`, role: r.pick(['officer', 'citizen', 'admin']) },
      entityId: r.bool(0.2) ? null : `case-${r.int(99)}`,
      payload: { caseId: `case-${r.int(99)}`, amount: 12_000, extra: genJson(r) },
      occurredAt: new Date(Date.UTC(2026, 10, 21, 0, i, r.int(60))).toISOString(),
    };
    const hash = chainHash(fields, prev);
    rows.push({ ...fields, seq: startSeq + i, prevHash: prev, hash });
    prev = hash;
  }
  return rows;
}

/** Same data with every object's keys in another order — what Postgres jsonb may hand back. */
function shuffleKeys(v: unknown, r: Rng): unknown {
  if (Array.isArray(v)) return v.map((x) => shuffleKeys(x, r));
  if (v === null || typeof v !== 'object') return v;
  const entries = Object.entries(v as Record<string, unknown>).map(
    ([k, x]) => [k, shuffleKeys(x, r)] as const,
  );
  for (let i = entries.length - 1; i > 0; i--) {
    const j = r.int(i + 1);
    [entries[i], entries[j]] = [entries[j]!, entries[i]!];
  }
  return Object.fromEntries(entries);
}

/** A different value of the same kind: the smallest edit an insider would make. */
function alter(v: unknown, r: Rng): unknown {
  if (typeof v === 'string')
    return r.bool() || !v ? `${v}x` : v.slice(0, -1) + (v.endsWith('1') ? '2' : '1');
  if (typeof v === 'number') return v + r.pick([1, -1, 108_000, 0.5]);
  if (typeof v === 'boolean') return !v;
  if (v === null) return r.pick([0, '', false, {}]);
  if (Array.isArray(v)) return v.length && r.bool() ? v.slice(1) : [...v, null];
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (!keys.length || r.bool(0.2)) return { ...o, injected: true };
  const k = r.pick(keys);
  if (r.bool(0.15)) {
    const { [k]: _gone, ...rest } = o;
    return rest;
  }
  return { ...o, [k]: alter(o[k], r) };
}

const FIELDS = [
  'eventId',
  'type',
  'source',
  'tenantId',
  'actor',
  'entityId',
  'payload',
  'occurredAt',
] as const;

forAll(
  'audit: an untouched chain verifies, and jsonb key reordering does not break it',
  (r) => genChain(r),
  (rows, r) => {
    const v = verifyRows(rows, GENESIS_HASH);
    assert.deepEqual([v.valid, v.checked], [true, rows.length]);
    if (v.valid) assert.deepEqual([v.lastSeq, v.lastHash], [rows.at(-1)!.seq, rows.at(-1)!.hash]);
    const reordered = rows.map((row) => shuffleKeys(row, r) as ChainRow);
    assert.equal(verifyRows(reordered, GENESIS_HASH).valid, true, 'key order changed the hash');
    // A page from the middle verifies against the hash before it (how the service walks the log in batches).
    const from = r.int(rows.length);
    assert.equal(
      verifyRows(rows.slice(from), from ? rows[from - 1]!.hash : GENESIS_HASH).valid,
      true,
    );
  },
);

forAll(
  'audit: editing any field of any entry is detected at that entry',
  (r) => {
    const rows = genChain(r);
    return { rows, at: r.int(rows.length), field: r.pick(FIELDS) };
  },
  ({ rows, at, field }, r) => {
    const target = rows[at]!;
    const edited = alter(target[field], r);
    assert.notEqual(
      canonicalJson(edited),
      canonicalJson(target[field]),
      'generator produced a no-op edit',
    );
    const tampered = rows.map((row, i) =>
      i === at ? ({ ...row, [field]: edited } as ChainRow) : row,
    );
    const v = verifyRows(tampered, GENESIS_HASH);
    assert.equal(v.valid, false, `edit of ${field} at seq ${target.seq} went unnoticed`);
    if (!v.valid)
      assert.deepEqual([v.brokenAtSeq, v.reason, v.checked], [target.seq, 'hash_mismatch', at]);
  },
);

forAll(
  'audit: an insider who edits an entry AND recomputes its hash is caught at the next entry',
  (r) => {
    const rows = genChain(r, 2);
    return { rows, at: r.int(rows.length - 1), field: r.pick(FIELDS) };
  },
  ({ rows, at, field }, r) => {
    const forged = { ...rows[at]!, [field]: alter(rows[at]![field], r) } as ChainRow;
    forged.hash = chainHash(forged, forged.prevHash);
    const v = verifyRows(
      rows.map((row, i) => (i === at ? forged : row)),
      GENESIS_HASH,
    );
    assert.equal(v.valid, false);
    if (!v.valid)
      assert.deepEqual([v.brokenAtSeq, v.reason], [rows[at + 1]!.seq, 'prev_hash_mismatch']);
  },
);

forAll(
  'audit: changing a stored hash or prevHash, deleting, swapping or inserting an entry is detected at the right place',
  (r) => {
    const rows = genChain(r, 3);
    return {
      rows,
      at: r.int(rows.length - 1),
      attack: r.pick(['hash', 'prevHash', 'delete', 'swap', 'insert'] as const),
    };
  },
  ({ rows, at, attack }) => {
    const flip = (h: string) => (h[0] === 'a' ? 'b' : 'a') + h.slice(1);
    let tampered: ChainRow[];
    let expected: [number, string];
    if (attack === 'hash') {
      tampered = rows.map((row, i) => (i === at ? { ...row, hash: flip(row.hash) } : row));
      expected = [rows[at]!.seq, 'hash_mismatch'];
    } else if (attack === 'prevHash') {
      tampered = rows.map((row, i) => (i === at ? { ...row, prevHash: flip(row.prevHash) } : row));
      expected = [rows[at]!.seq, 'prev_hash_mismatch'];
    } else if (attack === 'delete') {
      tampered = rows.filter((_, i) => i !== at);
      expected = [rows[at + 1]!.seq, 'prev_hash_mismatch'];
    } else if (attack === 'swap') {
      tampered = [...rows];
      [tampered[at], tampered[at + 1]] = [rows[at + 1]!, rows[at]!];
      expected = [rows[at + 1]!.seq, 'prev_hash_mismatch'];
    } else {
      const copy = {
        ...rows[at]!,
        eventId: '00000000-0000-4000-8000-ffffffffffff',
        payload: { caseId: 'ghost', amount: 99_000 },
      };
      const forged: ChainRow = { ...copy, hash: chainHash(copy, copy.prevHash) };
      tampered = [...rows.slice(0, at), forged, ...rows.slice(at)];
      expected = [rows[at]!.seq, 'prev_hash_mismatch'];
    }
    const v = verifyRows(tampered, GENESIS_HASH);
    assert.equal(v.valid, false, `${attack} at index ${at} went unnoticed`);
    if (!v.valid) assert.deepEqual([v.brokenAtSeq, v.reason], expected);
  },
);

forAll(
  'audit: canonical JSON is stable under key order and distinguishes different values',
  (r) => ({ a: genJson(r), b: genJson(r) }),
  ({ a, b }, r) => {
    assert.equal(canonicalJson(shuffleKeys(a, r)), canonicalJson(a));
    assert.deepEqual(JSON.parse(canonicalJson(a)), JSON.parse(JSON.stringify(a ?? null)));
    if (canonicalJson(a) === canonicalJson(b)) assert.deepEqual(a, b);
  },
);
