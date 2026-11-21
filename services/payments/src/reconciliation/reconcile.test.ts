import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile } from './reconcile';
import { backoffMs } from '../domain/webhook-signature';

test('reconciliation finds every kind of mismatch', () => {
  const items = reconcile(
    [
      { paymentId: 'p1', endToEndId: 'E1', amount: 12_000 },
      { paymentId: 'p2', endToEndId: 'E2', amount: 12_000 },
      { paymentId: 'p3', endToEndId: 'E3', amount: 12_000 },
    ],
    [
      { endToEndId: 'E1', amount: 12_000, status: 'ACSC' },
      { endToEndId: 'E2', amount: 1_200, status: 'ACSC' },
      { endToEndId: 'E4', amount: 9_000, status: 'ACSC' },
      { endToEndId: 'E5', amount: 9_000, status: 'RJCT' },
    ],
  );
  const by = Object.fromEntries(items.map((i) => [i.endToEndId, i.status]));
  assert.deepEqual(by, {
    E1: 'matched',
    E2: 'amount_mismatch',
    E3: 'missing_in_provider',
    E4: 'missing_in_ledger',
  });
});

test('the bank settling the same transfer twice is caught, not silently merged', () => {
  const items = reconcile(
    [{ paymentId: 'p1', endToEndId: 'E1', amount: 12_000 }],
    [
      { endToEndId: 'E1', amount: 12_000, status: 'ACSC' },
      { endToEndId: 'E1', amount: 12_000, status: 'ACSC' },
    ],
  );
  assert.deepEqual(
    items.map((i) => i.status),
    ['matched', 'duplicate_in_provider'],
  );
  assert.equal(items[1]!.paymentId, 'p1');
});

test('webhook retry backoff doubles', () => {
  assert.deepEqual([1, 2, 3].map(backoffMs), [10_000, 20_000, 40_000]);
});
