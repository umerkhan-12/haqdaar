import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from './auth/auth.service';
import { LoginThrottlerGuard } from './login-throttler.guard';

test('phone numbers normalise to one form (login lookup must not depend on formatting)', () => {
  for (const p of ['03001234567', '+923001234567', '92 300 1234567', '0300-1234567']) {
    assert.equal(normalizePhone(p), '923001234567');
  }
});

test('login rate-limit key is per (IP, phone): one shop full of people is not locked out together', async () => {
  const guard = Object.create(LoginThrottlerGuard.prototype) as LoginThrottlerGuard;
  const track = (req: object) => (guard as unknown as { getTracker(r: object): Promise<string> }).getTracker(req);
  const a = await track({ ip: '1.2.3.4', body: { phone: '03001110001' } });
  const b = await track({ ip: '1.2.3.4', body: { phone: '03001110002' } });
  const c = await track({ ip: '1.2.3.4', body: { phone: '+92 300 1110001' } });
  assert.notEqual(a, b);
  assert.equal(a, c, 'same account in different formats shares one bucket');
  assert.equal(await track({ ips: ['9.9.9.9'], ip: '10.0.0.1', body: {} }), '9.9.9.9');
});
