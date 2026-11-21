import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealMessage, verifySeal } from '@haqdaar/nest-kit';
import { amountInWords, receiptText } from './receipt';

test('amounts in Roman-Urdu words', () => {
  assert.equal(amountInWords(12000), 'barah hazaar');
  assert.equal(amountInWords(12500), 'barah hazaar paanch sau');
  assert.equal(amountInWords(25000), 'pachees hazaar');
});

test('receipt is sealed and tampering with the amount breaks the seal', () => {
  const secret = 's'.repeat(40);
  const msg = sealMessage(receiptText(12000, 'RAAST-1'), secret, new Date('2030-01-01'));
  assert.equal((verifySeal(msg, secret) as { valid: boolean }).valid, true);
  assert.equal((verifySeal(msg.replace('12,000', '1,200'), secret) as { valid: boolean }).valid, false);
});
