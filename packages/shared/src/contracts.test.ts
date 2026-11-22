import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWeakPin, PERSON_NAME, SignupVerifyRequest } from './contracts';

test('easy PINs are weak; ordinary ones are not', () => {
  for (const pin of ['0000', '1111', '9999', '1234', '2345', '6789', '4321', '9876', '3210'])
    assert.equal(isWeakPin(pin), true, pin);
  for (const pin of ['4826', '1357', '1235', '1224', '9075', '0001'])
    assert.equal(isWeakPin(pin), false, pin);
});

test('a name is letters of any script, never digits or symbols', () => {
  for (const ok of [
    'Zainab Bibi',
    'Nasreen Bi Bi',
    "O'Brien",
    'Kaneez-Fatima',
    'سکینہ بی بی',
    'M. Akram',
  ])
    assert.equal(PERSON_NAME.test(ok), true, ok);
  for (const bad of ['12', 'A1', '<script>', 'Robert); DROP', ' Zainab', '-Zainab', 'Zainab\u0007'])
    assert.equal(PERSON_NAME.test(bad), false, bad);
});

test('sign-up refuses an easy PIN and a non-name, accepts a normal request', () => {
  const base = { phone: '03451234567', code: '123456', fullName: 'Sakina Bibi', pin: '4826' };
  assert.equal(SignupVerifyRequest.safeParse(base).success, true);
  assert.equal(SignupVerifyRequest.safeParse({ ...base, pin: '1234' }).success, false);
  assert.equal(SignupVerifyRequest.safeParse({ ...base, pin: '7777' }).success, false);
  assert.equal(SignupVerifyRequest.safeParse({ ...base, fullName: '99' }).success, false);
  assert.equal(SignupVerifyRequest.safeParse({ ...base, phone: '3451234567' }).success, false);
  assert.equal(SignupVerifyRequest.safeParse({ ...base, code: '12345' }).success, false);
});
