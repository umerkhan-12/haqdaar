// End-to-end business flows and their worst cases: claim â†’ decision â†’ payout â†’ receipt.
// Loaded by e2e.mjs. Requires a reset demo state (`pnpm e2e` resets first).
import { randomUUID } from 'node:crypto';
import { api, describe, expect, expectStatus, it, login, registerSuite, token, ZAINAB } from './e2e-lib.mjs';

const RASHIDA = '10000000-0000-4000-8000-000000000002';
const ZAINAB_CLAIM = {
  type: 'relief_claim',
  fullName: 'Zainab Bibi',
  cnic: '42201-1234567-4',
  district: 'Thatta',
  householdSize: 5,
  payout: { alias: '03001110001' },
};
const RASHIDA_CLAIM = {
  type: 'relief_claim',
  fullName: 'Rashida Begum',
  cnic: '42201-7654321-2',
  district: 'Karachi West',
  householdSize: 7,
  payout: { alias: '03001110007' },
};

const items = (body) => (Array.isArray(body) ? body : (body?.items ?? []));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(300);
  }
}

async function paymentsForCase(caseId) {
  const r = await api('GET', '/payments', { token: await token('officer') });
  expectStatus(r, 200);
  return items(r.body).filter((p) => p.caseId === caseId);
}

async function grantConsents(tok, personId) {
  for (const purpose of ['identity_verification', 'household_data']) {
    expectStatus(await api('POST', '/consents', { token: tok, body: { personId, purpose } }), 200, 201);
  }
}

async function setFault(mode, remaining = 1) {
  const r = await api('POST', '/mock/faults', {
    token: await token('admin'),
    body: { raast: { mode, remaining } },
  });
  expectStatus(r, 200, 201);
}

registerSuite(async () => {
  describe('Claim â†’ decision â†’ payout (happy path)');
  const citizen = await token('citizen');
  let zainabCase;

  await it('citizen cannot grant consent for someone else', async () => {
    expectStatus(
      await api('POST', '/consents', { token: citizen, body: { personId: RASHIDA, purpose: 'household_data' } }),
      403,
    );
  });

  await it('claim without consent â†’ ASK_MORE (never processed with data she did not share)', async () => {
    const r = await api('POST', '/cases', {
      token: citizen,
      body: ZAINAB_CLAIM,
      headers: { 'idempotency-key': `noconsent-${randomUUID()}` },
    });
    expectStatus(r, 200, 201);
    expect(r.body.status === 'NEEDS_INFO' && r.body.lane === 'ASK_MORE', `${r.body.status}/${r.body.lane}`);
    zainabCase = r.body;
  });

  await it('after consent, resubmit â†’ AUTO_APPROVE with an Urdu explanation', async () => {
    await grantConsents(citizen, ZAINAB);
    const r = await api('POST', `/cases/${zainabCase.id}/resubmit`, { token: citizen });
    expectStatus(r, 200, 201);
    expect(r.body.status === 'APPROVED' && r.body.lane === 'AUTO_APPROVE', `${r.body.status}/${r.body.lane}`);
    zainabCase = r.body;
  });

  await it('payout runs automatically: SUCCESS, exactly one payment, case becomes PAID', async () => {
    const pay = await waitFor(async () => {
      const ps = await paymentsForCase(zainabCase.id);
      return ps.find((p) => p.state === 'SUCCESS') && ps;
    }, 'payment SUCCESS');
    expect(pay.length === 1, `payments for case: ${pay.length}`);
    expect(pay[0].amount === 12000, `amount ${pay[0].amount}`);
    await waitFor(async () => {
      const c = await api('GET', `/cases/${zainabCase.id}`, { token: citizen });
      return c.body.status === 'PAID';
    }, 'case PAID');
  });

  await it('ledger is balanced (double entry: debits = credits)', async () => {
    const r = await api('GET', '/ledger/balances', { token: await token('admin') });
    expectStatus(r, 200);
    const text = JSON.stringify(r.body);
    expect(/12000/.test(text), `balances: ${text.slice(0, 200)}`);
    const all = items(r.body).length ? items(r.body) : (r.body.accounts ?? []);
    if (all.length) {
      const sum = all.reduce((s, a) => s + Number(a.balance ?? 0), 0);
      expect(sum === 0, `balances sum to ${sum}`);
    }
  });

  describe('Idempotency & duplicates');

  await it('same idempotency key twice â†’ same case, no second claim', async () => {
    const key = `dup-${randomUUID()}`;
    const a = await api('POST', '/cases', { token: citizen, body: ZAINAB_CLAIM, headers: { 'idempotency-key': key } });
    const b = await api('POST', '/cases', { token: citizen, body: ZAINAB_CLAIM, headers: { 'idempotency-key': key } });
    expect(a.body.id && a.body.id === b.body.id, `${a.body.id} vs ${b.body.id}`);
  });

  await it('5 parallel submits with one key (double-tap on a slow phone) â†’ one case', async () => {
    const key = `race-${randomUUID()}`;
    const rs = await Promise.all(
      Array.from({ length: 5 }, () =>
        api('POST', '/cases', { token: citizen, body: ZAINAB_CLAIM, headers: { 'idempotency-key': key } }),
      ),
    );
    const ids = new Set(rs.filter((r) => r.status < 300).map((r) => r.body.id));
    expect(ids.size === 1, `distinct cases: ${ids.size}, statuses ${rs.map((r) => r.status)}`);
  });

  await it('second claim in the same month is never auto-approved (duplicate flag â†’ human)', async () => {
    const r = await api('POST', '/cases', {
      token: citizen,
      body: ZAINAB_CLAIM,
      headers: { 'idempotency-key': `second-${randomUUID()}` },
    });
    expect(r.body.lane !== 'AUTO_APPROVE', `lane ${r.body.lane}`);
  });

  await it('missing idempotency key â†’ 400', async () => {
    expectStatus(await api('POST', '/cases', { token: citizen, body: ZAINAB_CLAIM }), 400);
  });

  await it('claiming with another personâ€™s CNIC â†’ 403', async () => {
    expectStatus(
      await api('POST', '/cases', {
        token: citizen,
        body: RASHIDA_CLAIM,
        headers: { 'idempotency-key': `steal-${randomUUID()}` },
      }),
      403,
    );
  });

  describe('Access control on cases');

  await it('citizen cannot open the officer queue or approve/reject', async () => {
    expectStatus(await api('GET', '/queue', { token: citizen }), 403);
    expectStatus(await api('POST', `/cases/${zainabCase.id}/reject`, { token: citizen, body: { reason: 'nope nope' } }), 403);
  });

  await it('officer reject needs a reason; queue never shows raw CNICs', async () => {
    const officer = await token('officer');
    const q = await api('GET', '/queue', { token: officer });
    expectStatus(q, 200);
    expect(!/\d{5}-\d{7}-\d/.test(JSON.stringify(q.body)), 'unmasked CNIC in queue');
    const open = items(q.body)[0];
    if (open) expectStatus(await api('POST', `/cases/${open.id}/reject`, { token: officer, body: {} }), 400);
  });

  describe('Helper Mode');

  let helperForRashida;
  await it('helper needs the family PIN; wrong PIN â†’ 401', async () => {
    const helper = await token('helper');
    const fam = await api('GET', '/auth/families', { token: helper });
    expect(fam.body.length === 2, `families: ${fam.body.length}`);
    expectStatus(await api('POST', '/auth/act-for', { token: helper, body: { personId: RASHIDA, pin: '9999' } }), 401);
    const ok = await api('POST', '/auth/act-for', { token: helper, body: { personId: RASHIDA, pin: '2222' } });
    expectStatus(ok, 200);
    helperForRashida = ok.body.accessToken;
  });

  await it('helper acting for Rashida cannot touch Zainab', async () => {
    expectStatus(await api('GET', `/cases/${zainabCase.id}`, { token: helperForRashida }), 403, 404);
    expectStatus(
      await api('POST', '/consents', { token: helperForRashida, body: { personId: ZAINAB, purpose: 'payment' } }),
      403,
    );
  });

  describe('Bank-grade payouts (fintech worst cases)');

  await it('Raast times out AFTER debiting â†’ UNKNOWN â†’ status inquiry â†’ SUCCESS, paid exactly once', async () => {
    await grantConsents(helperForRashida, RASHIDA);
    await setFault('timeout_after_debit', 1);
    const r = await api('POST', '/cases', {
      token: helperForRashida,
      body: RASHIDA_CLAIM,
      headers: { 'idempotency-key': `rashida-${randomUUID()}` },
    });
    expect(r.body.status === 'APPROVED', `case ${r.body.status}/${r.body.lane}`);
    const ps = await waitFor(async () => {
      const list = await paymentsForCase(r.body.id);
      return list.find((p) => p.state === 'SUCCESS') && list;
    }, 'inquiry to settle the UNKNOWN payment', 30_000);
    expect(ps.length === 1, `payments: ${ps.length}`);
    const detail = await api('GET', `/payments/${ps[0].id}`, { token: await token('officer') });
    const states = (detail.body.transitions ?? []).map((t) => t.to);
    expect(states.includes('UNKNOWN'), `transitions: ${states.join(' â†’ ')}`);
    expect(!states.slice(states.indexOf('UNKNOWN') + 1).includes('SENT'), 'resent blindly after UNKNOWN');
  });

  await it('payout to a mule account (title mismatch) is HELD, and the maker cannot approve it', async () => {
    const officer = await token('officer');
    const officer2 = await token('officer2');
    const claim = await api('POST', '/cases', {
      token: citizen,
      body: { ...ZAINAB_CLAIM, payout: { alias: '03009990000' } },
      headers: { 'idempotency-key': `mule-${randomUUID()}` },
    });
    expectStatus(await api('POST', `/cases/${claim.body.id}/approve`, { token: officer, body: { note: 'test' } }), 200, 201);
    const held = await waitFor(
      async () => (await paymentsForCase(claim.body.id)).find((p) => p.state === 'HELD'),
      'HELD payment',
    );
    expect(/TITLE/i.test(held.holdReason ?? ''), `hold reason ${held.holdReason}`);
    expectStatus(await api('POST', `/payments/${held.id}/release`, { token: officer2, body: {} }), 200, 201);
    const self = await api('POST', `/payments/${held.id}/approve`, { token: officer2, body: {} });
    expectStatus(self, 403);
  });

  await it('reconciliation matches our ledger with the Raast statement', async () => {
    const r = await api('POST', '/reconciliation/run', { token: await token('admin'), body: {} });
    expectStatus(r, 200, 201);
    const text = JSON.stringify(r.body);
    expect(/matched/i.test(text), text.slice(0, 200));
  });

  await it('payments API refuses citizens', async () => {
    expectStatus(await api('GET', '/payments', { token: citizen }), 403);
  });

  await login('auditor');
});
