import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameMatchScore, TITLE_MATCH_THRESHOLD } from './name-match';
import { velocityBreached } from './velocity';
import { assertBalanced, deriveBalances, payoutLines, reversalLines } from './ledger';
import { signWebhook, verifyWebhook } from './webhook-signature';
import { newEndToEndId, transitionError } from './transition';

test('name match: same person despite case, order and transliteration', () => {
  assert.equal(nameMatchScore('Zainab Bibi', 'ZAINAB BIBI'), 1);
  assert.equal(nameMatchScore('Bibi Zainab', 'ZAINAB BIBI'), 1);
  assert.ok(nameMatchScore('Muhammad Aslam', 'MOHD ASLAM') >= 0.95);
  assert.ok(nameMatchScore('Rashida Begum', 'RASHIDA BEGAM') >= TITLE_MATCH_THRESHOLD);
});

test('name match: mule account title does not match the beneficiary', () => {
  assert.ok(nameMatchScore('Zainab Bibi', 'MUHAMMAD ASLAM') < TITLE_MATCH_THRESHOLD);
  assert.equal(nameMatchScore('', 'ZAINAB'), 0);
});

test('velocity: account receiving for 2 other people in 24h is held', () => {
  const now = new Date('2026-11-21T12:00:00Z');
  const h = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000);
  const recent = [
    { personId: 'b', createdAt: h(2) },
    { personId: 'c', createdAt: h(5) },
  ];
  assert.equal(velocityBreached('a', recent, now), true);
  assert.equal(velocityBreached('a', [recent[0]!, { personId: 'a', createdAt: h(1) }], now), false);
  assert.equal(
    velocityBreached('a', [recent[0]!, { personId: 'c', createdAt: h(30) }], now),
    false,
  );
});

test('ledger: groups balance, reversal mirrors payout, balances net to zero', () => {
  const all = [...payoutLines(12_000), ...reversalLines(12_000)];
  assert.ok(deriveBalances(all).every((b) => b.balance === 0));
  assert.throws(() => assertBalanced([{ account: 'x', direction: 'DEBIT', amount: 5 }]));
  assert.throws(() =>
    assertBalanced([
      { account: 'x', direction: 'DEBIT', amount: 5 },
      { account: 'y', direction: 'CREDIT', amount: 4 },
    ]),
  );
  assert.throws(() => payoutLines(0));
});

test('webhook signature verifies, rejects tampering and replays', () => {
  const body = '{"type":"payments.payment.state_changed"}';
  const header = signWebhook(body, 's3cret', 1_000);
  assert.equal(verifyWebhook(header, body, 's3cret', 300, 1_100), true);
  assert.equal(verifyWebhook(header, body.replace('state', 'STATE'), 's3cret', 300, 1_100), false);
  assert.equal(verifyWebhook(header, body, 'wrong', 300, 1_100), false);
  assert.equal(verifyWebhook(header, body, 's3cret', 300, 2_000), false);
});

test('transition guard: UNKNOWN is never re-sent, SUCCESS is final except reversal', () => {
  assert.equal(transitionError('SENT', 'UNKNOWN'), null);
  assert.match(transitionError('UNKNOWN', 'SENT')!, /Illegal/);
  assert.match(transitionError('SUCCESS', 'FAILED')!, /Illegal/);
  assert.equal(transitionError('SUCCESS', 'REVERSAL_REQUESTED'), null);
});

test('end-to-end id fits ISO 20022 (max 35 chars) and is unique', () => {
  const a = newEndToEndId();
  assert.ok(a.length <= 35);
  assert.notEqual(a, newEndToEndId());
});
