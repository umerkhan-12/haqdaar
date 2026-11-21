import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from './auth/auth.service';
import { LoginThrottlerGuard } from './login-throttler.guard';
import { LaunchProgramRequest } from '@haqdaar/shared';
import { dailyUsage, dayRange, monthStart, quotaView } from './tenants/usage';

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

test('usage report: zero-filled days, per-service sums, AI calls, rows outside the window ignored', () => {
  const days = dayRange(3, new Date('2026-11-21T23:59:00Z'));
  assert.deepEqual(days, ['2026-11-19', '2026-11-20', '2026-11-21']);
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const daily = dailyUsage(
    days,
    [
      { day: d('2026-11-21'), service: 'cases', requests: 5, errors: 1 },
      { day: d('2026-11-21'), service: 'identity', requests: 2, errors: 0 },
      { day: d('2026-11-01'), service: 'cases', requests: 99, errors: 0 },
    ],
    [{ day: d('2026-11-20'), calls: 3, failures: 0, fallbacks: 1 }],
  );
  assert.equal(daily[0]!.requests, 0);
  assert.equal(daily[1]!.aiCalls, 3);
  assert.deepEqual(daily[2], {
    day: '2026-11-21',
    requests: 7,
    errors: 1,
    aiCalls: 0,
    services: { cases: { requests: 5, errors: 1 }, identity: { requests: 2, errors: 0 } },
  });
  assert.equal(monthStart(new Date('2026-11-21T10:00:00Z')).toISOString(), '2026-11-01T00:00:00.000Z');
});

test('quota: percent used to one decimal, exceeded flag', () => {
  assert.deepEqual(quotaView(100_000, 12_345), {
    monthlyRequestQuota: 100_000,
    monthToDateRequests: 12_345,
    percentUsed: 12.3,
    exceeded: false,
  });
  assert.equal(quotaView(1000, 1001).exceeded, true);
});

test('launch a program: Pakistani mobile and a real password are required', () => {
  const ok = { programName: 'Flood Relief Sindh', type: 'relief', adminName: 'Admin Noor', adminPassword: 'longenough1' };
  assert.equal(LaunchProgramRequest.safeParse({ ...ok, adminPhone: '0345-1234567' }).success, true);
  assert.equal(LaunchProgramRequest.safeParse({ ...ok, adminPhone: '+92 345 1234567' }).success, true);
  assert.equal(LaunchProgramRequest.safeParse({ ...ok, adminPhone: '12345' }).success, false);
  assert.equal(LaunchProgramRequest.safeParse({ ...ok, adminPhone: '03451234567', adminPassword: 'short' }).success, false);
  assert.equal(LaunchProgramRequest.safeParse({ ...ok, adminPhone: '03451234567', type: 'bank' }).success, false);
});
