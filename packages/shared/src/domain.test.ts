import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoApproveThreshold, canTransition, DEFAULT_COSTS } from './domain';

test('cost model gives the 0.988 auto-approve threshold', () => {
  assert.equal(autoApproveThreshold(DEFAULT_COSTS).toFixed(3), '0.988');
});

test('payment state machine blocks illegal transitions', () => {
  assert.equal(canTransition('SENT', 'UNKNOWN'), true);
  assert.equal(canTransition('UNKNOWN', 'SENT'), false); // never retry blindly
  assert.equal(canTransition('CREATED', 'SUCCESS'), false);
  assert.equal(canTransition('REVERSED', 'SUCCESS'), false);
});
