#!/usr/bin/env node
// A brand-new citizen, end to end: sign up → consent → claim → officer approves → second officer
// releases → the money arrives. Fictional identity only (a specimen CNIC and a random test number).
// Usage: E2E_GATEWAY=https://<host>/api node scripts/e2e-signup-payout.mjs
import { randomInt, randomUUID } from 'node:crypto';
import {
  api,
  describe,
  expect,
  expectStatus,
  it,
  registerSuite,
  runAll,
  token,
} from './e2e-lib.mjs';

const phone = `0300${randomInt(2000000, 9999999)}`;
const fullName = 'Sakina Test';
const cnic = `42000-${randomInt(1000000, 9999999)}-${randomInt(0, 9)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

registerSuite(async () => {
  describe(`New citizen ${phone}: sign-up to payout`);

  let citizen, personId, claim, payment;

  await it('sign up with the simulated SMS code', async () => {
    expectStatus(await api('POST', '/auth/signup/start', { body: { phone } }), 200, 201);
    const sms = await api('GET', `/mock/sms/signup/${phone}`);
    const code = sms.body?.message?.body?.match(/\d{6}|\d{4}/)?.[0];
    expect(code, `no code in the simulated SMS: ${JSON.stringify(sms.body).slice(0, 200)}`);
    const r = await api('POST', '/auth/signup/verify', {
      body: { phone, code, fullName, pin: '4826' },
    });
    expectStatus(r, 201);
    citizen = r.body.accessToken;
    personId = JSON.parse(Buffer.from(citizen.split('.')[1], 'base64url').toString()).personId;
    expect(personId, 'token carries no personId');
  });

  await it('consent, then claim: a first claim of a new account always goes to an officer', async () => {
    for (const purpose of ['household_data', 'payment']) {
      expectStatus(
        await api('POST', '/consents', { token: citizen, body: { personId, purpose } }),
        200,
        201,
      );
    }
    const r = await api('POST', '/cases', {
      token: citizen,
      body: {
        type: 'relief_claim',
        fullName,
        cnic,
        district: 'Thatta',
        householdSize: 4,
        payout: { alias: phone },
      },
      headers: { 'idempotency-key': `signup-${randomUUID()}` },
    });
    expectStatus(r, 200, 201);
    claim = r.body;
    expect(
      claim.state !== 'AUTO_APPROVED' && claim.decision !== 'AUTO_APPROVE',
      `was auto-approved: ${claim.state}`,
    );
  });

  await it('officer approves; the payout is created', async () => {
    const officer = await token('officer');
    expectStatus(
      await api('POST', `/cases/${claim.id}/approve`, {
        token: officer,
        body: { note: 'checked' },
      }),
      200,
      201,
    );
    for (let i = 0; i < 30 && !payment; i++) {
      await sleep(1000);
      const list = await api('GET', '/payments?take=100', { token: officer });
      payment = (list.body?.items ?? list.body ?? []).find((p) => p.caseId === claim.id);
    }
    expect(payment, 'no payment appeared for the approved claim');
  });

  await it('payout succeeds (second officer releases it if it is held)', async () => {
    const officer = await token('officer');
    const officer2 = await token('officer2');
    let state = payment.state;
    for (let i = 0; i < 40; i++) {
      const p = await api('GET', `/payments/${payment.id}`, { token: officer });
      state = p.body?.state ?? state;
      if (state === 'SUCCESS' || state === 'FAILED') {
        expect(
          state === 'SUCCESS',
          `payout FAILED: ${JSON.stringify(p.body?.transitions?.at?.(-1) ?? p.body).slice(0, 300)}`,
        );
        return;
      }
      if (state === 'HELD')
        await api('POST', `/payments/${payment.id}/release`, { token: officer2, body: {} });
      // maker-checker: the officer who approved the claim cannot also approve the money
      if (state === 'AWAITING_APPROVAL')
        await api('POST', `/payments/${payment.id}/approve`, { token: officer2, body: {} });
      await sleep(1500);
    }
    throw new Error(`payout still ${state} after a minute`);
  });
});

await runAll();
