import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decryptField, encryptField, lookupHash, maskCnic } from './crypto';

const key = 'a'.repeat(64);

test('encrypt/decrypt round trip, ciphertext differs each time', () => {
  const a = encryptField('42101-1234567-3', key);
  const b = encryptField('42101-1234567-3', key);
  assert.notEqual(a, b);
  assert.equal(decryptField(a, key), '42101-1234567-3');
});

test('tampered ciphertext is rejected', () => {
  const parts = encryptField('secret', key).split('.');
  parts[3] = Buffer.from('tampered').toString('base64');
  assert.throws(() => decryptField(parts.join('.'), key));
});

test('lookup hash is deterministic', () => {
  assert.equal(lookupHash('42101-1234567-3', key), lookupHash(' 42101-1234567-3 ', key));
});

test('mask CNIC', () => {
  assert.equal(maskCnic('42101-1234567-3'), '42101-*****67-3');
});
