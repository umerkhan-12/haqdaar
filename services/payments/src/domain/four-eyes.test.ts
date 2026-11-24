import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkerRefusal, retryNeedsSecondOfficer } from './four-eyes';

const A = 'officer-a';
const B = 'officer-b';

test('four-eyes: the officer who approved the claim cannot approve its payout', () => {
  const makers = [{ actorId: A, action: 'CLAIM_APPROVE' }];
  assert.match(checkerRefusal(A, makers, A) ?? '', /approved this claim/);
  assert.equal(checkerRefusal(A, makers, B), null);
});

test('four-eyes: a release by someone else does not clear the claim approver', () => {
  const makers = [
    { actorId: B, action: 'RELEASE' },
    { actorId: A, action: 'CLAIM_APPROVE' },
  ];
  assert.match(checkerRefusal(B, makers, A) ?? '', /approved this claim/);
  assert.match(checkerRefusal(B, makers, B) ?? '', /released this payout/);
  assert.equal(checkerRefusal(B, makers, 'officer-c'), null);
});

test('four-eyes: the retrying officer cannot approve the retry; other approvals do not count', () => {
  assert.match(checkerRefusal(A, [{ actorId: A, action: 'RETRY_REQUEST' }], A) ?? '', /sent again/);
  assert.equal(checkerRefusal('system', [{ actorId: A, action: 'APPROVE' }], A), null);
  assert.match(checkerRefusal(A, [], A) ?? '', /Four-eyes/);
});

test('retry: a new account or a large amount needs a second officer', () => {
  assert.equal(retryNeedsSecondOfficer(12_000, 20_000, undefined, '03001234567'), false);
  assert.equal(retryNeedsSecondOfficer(12_000, 20_000, '03001234567', '03001234567'), false);
  assert.equal(retryNeedsSecondOfficer(12_000, 20_000, '03007654321', '03001234567'), true);
  assert.equal(retryNeedsSecondOfficer(25_000, 20_000, undefined, '03001234567'), true);
});
