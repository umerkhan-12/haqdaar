import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealMessage, verifySeal } from './seal';

const secret = 'test-secret';
const future = new Date('2030-01-01');
const body = 'Sahara Program: Rs 12,000 has been sent to your account for November.';

test('genuine sealed message verifies, even after reformatting', () => {
  const msg = sealMessage(body, secret, future);
  assert.deepEqual(verifySeal(msg, secret), { present: true, valid: true, expiry: '20300101' });
  assert.equal(verifySeal(msg.toUpperCase().replace(/ /g, '  '), secret).present, true);
  assert.equal((verifySeal(msg.replace(/ /g, '  '), secret) as { valid: boolean }).valid, true);
});

test('changing the amount breaks the seal', () => {
  const msg = sealMessage(body, secret, future).replace('12,000', '120,000');
  assert.equal((verifySeal(msg, secret) as { valid: boolean }).valid, false);
});

test('copying a real code onto a scam message fails', () => {
  const code = sealMessage(body, secret, future).split('\n')[1]!;
  const scam = `Send Rs 500 fee to 0300-1234567 to receive your relief.\n${code}`;
  assert.equal((verifySeal(scam, secret) as { valid: boolean }).valid, false);
});

test('expired seal is rejected; no seal reports not present', () => {
  const msg = sealMessage(body, secret, new Date('2020-01-01'));
  assert.deepEqual(verifySeal(msg, secret), {
    present: true,
    valid: false,
    reason: 'expired',
    expiry: '20200101',
  });
  assert.deepEqual(verifySeal(body, secret), { present: false });
});
