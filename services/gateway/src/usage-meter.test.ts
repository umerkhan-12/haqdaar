import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServiceClient } from '@haqdaar/nest-kit';
import { serviceFor, tenantFromAuth, UsageMeter } from './usage-meter';

const TID = '00000000-0000-4000-8000-000000000001';
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const bearer = (claims: object) => `Bearer ${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;
const DAY = new Date('2026-11-21T10:00:00Z');

function meterWith(call: (body: unknown) => Promise<unknown>) {
  const sent: unknown[] = [];
  const client = {
    call: (_t: string, _p: string, o: { body: unknown }) => (sent.push(o.body), call(o.body)),
  };
  return { meter: new UsageMeter(client as unknown as ServiceClient), sent };
}

test('tid is read from the token payload; garbage or non-uuid tids are ignored', () => {
  assert.equal(tenantFromAuth(bearer({ tid: TID })), TID);
  assert.equal(tenantFromAuth(bearer({ tid: 'not-a-uuid' })), null);
  assert.equal(tenantFromAuth('Bearer x.!!!.y'), null);
  assert.equal(tenantFromAuth('Basic abc'), null);
  assert.equal(tenantFromAuth(undefined), null);
});

test('paths map to the service the proxy routes them to', () => {
  assert.equal(serviceFor('/cases/123?x=1'), 'cases');
  assert.equal(serviceFor('/rules'), 'cases');
  assert.equal(serviceFor('/tenants/me'), 'identity');
  assert.equal(serviceFor('/status'), null);
  assert.equal(serviceFor('/casesx'), null);
});

test('counts per tenant/day/service; 5xx are errors; 401s and anonymous calls are not counted', () => {
  const { meter } = meterWith(async () => ({}));
  const auth = bearer({ tid: TID });
  meter.record(auth, '/cases', 200, DAY);
  meter.record(auth, '/cases/1', 503, DAY);
  meter.record(auth, '/rules', 404, DAY);
  meter.record(auth, '/cases', 401, DAY); // forged/expired token: rejected upstream, not metered
  meter.record(undefined, '/auth/login', 200, DAY);
  meter.record(auth, '/ai/scam-check', 200, DAY);
  const entries = meter.pending().entries.sort((a, b) => a.service.localeCompare(b.service));
  assert.deepEqual(entries, [
    { tenantId: TID, day: '2026-11-21', service: 'ai', requests: 1, errors: 0 },
    { tenantId: TID, day: '2026-11-21', service: 'cases', requests: 3, errors: 1 },
  ]);
});

test('a failed flush keeps the counts and merges them into the next one', async () => {
  let fail = true;
  const { meter, sent } = meterWith(async () => {
    if (fail) throw new Error('identity down');
    return {};
  });
  const auth = bearer({ tid: TID });
  meter.record(auth, '/cases', 200, DAY);
  await meter.flush();
  meter.record(auth, '/cases', 200, DAY);
  fail = false;
  await meter.flush();
  assert.equal(sent.length, 2);
  assert.equal((sent[1] as { entries: { requests: number }[] }).entries[0]!.requests, 2);
  assert.equal(meter.pending().entries.length, 0);
});
