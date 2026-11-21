import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, chainHash, entityIdOf, GENESIS_HASH, verifyRows, type ChainFields, type ChainRow } from './chain';

function buildChain(n: number): ChainRow[] {
  const rows: ChainRow[] = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const fields: ChainFields = {
      eventId: `00000000-0000-4000-8000-00000000000${i}`,
      type: 'cases.case.decided',
      source: 'cases',
      tenantId: 't1',
      actor: { id: 'u1', role: 'officer' },
      entityId: `case-${i}`,
      payload: { caseId: `case-${i}`, amount: 12000, lane: 'AUTO_APPROVE' },
      occurredAt: new Date(Date.UTC(2026, 10, 21, 0, i)).toISOString(),
    };
    const hash = chainHash(fields, prev);
    rows.push({ ...fields, seq: i, prevHash: prev, hash });
    prev = hash;
  }
  return rows;
}

test('canonical JSON ignores key order (jsonb may reorder keys)', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }), canonicalJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }));
});

test('an untouched chain verifies', () => {
  const r = verifyRows(buildChain(5), GENESIS_HASH);
  assert.equal(r.valid, true);
  assert.equal(r.checked, 5);
});

test('editing a payload is detected at that row', () => {
  const rows = buildChain(5);
  rows[2]!.payload = { caseId: 'case-3', amount: 120000, lane: 'AUTO_APPROVE' };
  const r = verifyRows(rows, GENESIS_HASH);
  assert.equal(r.valid, false);
  assert.equal(!r.valid && r.brokenAtSeq, 3);
  assert.equal(!r.valid && r.reason, 'hash_mismatch');
});

test('deleting a row is detected at the next row', () => {
  const rows = buildChain(5);
  rows.splice(1, 1);
  const r = verifyRows(rows, GENESIS_HASH);
  assert.equal(!r.valid && r.brokenAtSeq, 3);
  assert.equal(!r.valid && r.reason, 'prev_hash_mismatch');
});

test('rewriting a row AND its hash still breaks the following link', () => {
  const rows = buildChain(4);
  const forged = { ...rows[1]!, payload: { caseId: 'case-2', amount: 1 } };
  forged.hash = chainHash(forged, forged.prevHash);
  rows[1] = forged;
  const r = verifyRows(rows, GENESIS_HASH);
  assert.equal(!r.valid && r.brokenAtSeq, 3);
});

test('entity id extraction prefers caseId', () => {
  assert.equal(entityIdOf({ paymentId: 'p', caseId: 'c' }), 'c');
  assert.equal(entityIdOf({ userId: 'u' }), 'u');
  assert.equal(entityIdOf({ task: 'x' }), null);
});
