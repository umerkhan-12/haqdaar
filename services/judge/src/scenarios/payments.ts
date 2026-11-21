import { FAMILIES, MULE_ALIAS } from '../demo-data';
import { waitFor } from '../run';
import type { Scenario } from './types';
import {
  claimFor,
  ensureApproved,
  grantConsents,
  items,
  paymentsForCase,
  setRaastFault,
  waitForPayment,
  type CaseView,
} from './helpers';

interface PaymentDetail {
  id: string;
  state: string;
  transitions: { from: string | null; to: string; reason: string | null }[];
  ledger?: { direction: string; amount: number; account: string }[];
}

const raastTimeout: Scenario = {
  id: 'pay-raast-timeout',
  challenge: 'PAY',
  title: 'Raast times out after taking the money',
  proves: 'A lost response is never retried blindly: the payment becomes UNKNOWN, a status inquiry settles it, she is paid exactly once.',
  async run({ api, run }) {
    await run.step('Inject fault on Rashida’s account: Raast settles, then the response is lost', () =>
      setRaastFault(api, 'timeout_after_debit', 1, FAMILIES.rashida.alias),
    );
    try {
      const c = await claimFor(api, run, FAMILIES.rashida);
      await ensureApproved(api, run, c);
      const p = await run.step(
        'Payout: SENT → (timeout) → UNKNOWN → status inquiry',
        () => waitForPayment(api, c.id, ['SUCCESS', 'FAILED'], 40_000),
        (v) => `final state ${v.state}`,
      );
      const detail = await api.call<PaymentDetail>('GET', `/payments/${p.id}`, { token: await api.as('officer') });
      const path = detail.body.transitions.map((t) => t.to);
      run.note('State path', path.join(' → '));
      run.check('Went through UNKNOWN', path.includes('UNKNOWN'));
      run.check('Never resent after UNKNOWN', !path.slice(path.indexOf('UNKNOWN') + 1).includes('SENT'));
      run.check('Paid exactly once', (await paymentsForCase(api, c.id)).length === 1 && p.state === 'SUCCESS');
      return `Path: ${path.join(' → ')}. One payment, one ledger entry.`;
    } finally {
      await setRaastFault(api, 'none', 0);
    }
  },
};

const doublePayment: Scenario = {
  id: 'pay-double-click',
  challenge: 'PAY',
  title: 'Double click / retry storm',
  proves: 'The same payout requested many times moves money once: idempotency key + unique constraint + illegal transitions refused.',
  async run({ api, run }) {
    const f = FAMILIES.nasreen;
    const token = await api.family(f);
    await grantConsents(api, token, f.personId);
    const key = api.newIdempotencyKey('double');
    const body = {
      type: 'relief_claim',
      fullName: f.fullName,
      cnic: f.cnic,
      district: f.district,
      householdSize: f.householdSize,
      payout: { alias: f.alias },
    };
    const rs = await run.step(
      'Pay button pressed 3 times at the same moment',
      () => Promise.all([1, 2, 3].map(() => api.call<CaseView>('POST', '/cases', { token, body, headers: { 'idempotency-key': key } }))),
      (all) => `statuses ${all.map((r) => r.status).join(', ')}`,
    );
    const ids = new Set(rs.filter((r) => r.status < 300).map((r) => r.body.id));
    run.check('One case', ids.size === 1, `${ids.size} cases`);
    const c = rs.find((r) => r.status < 300)!.body;
    await ensureApproved(api, run, c);
    const p = await run.step('Payout settles', () => waitForPayment(api, c.id, ['SUCCESS'], 30_000), (v) => v.state);
    const retry = await run.step(
      'Officer presses "pay again" on the paid payout',
      async () => api.call('POST', `/payments/${p.id}/retry`, { token: await api.as('officer') }),
      (r) => `HTTP ${r.status}: ${r.body?.message}`,
    );
    run.check('Paying a paid payout is refused', retry.status === 409);
    const all = await paymentsForCase(api, c.id);
    run.check('One payment', all.length === 1, `${all.length} payments`);
    return '3 simultaneous submits → 1 case → 1 payment; "pay again" on a paid payout refused (409).';
  },
};

const muleAccount: Scenario = {
  id: 'pay-mule-account',
  challenge: 'PAY',
  title: 'Payout to a fraudster (mule) account',
  proves: 'Before paying, the account title is fetched and matched to the beneficiary: a mismatch holds the money for an officer.',
  async run({ api, run }) {
    const c = await claimFor(api, run, FAMILIES.nasreen, { alias: MULE_ALIAS });
    await ensureApproved(api, run, c);
    const p = await run.step(
      'Title fetch + name match before sending',
      () => waitForPayment(api, c.id, ['HELD', 'SUCCESS'], 20_000),
      (v) => `${v.state}: account title "${v.titleFetched}" vs beneficiary "${v.creditorName}" (score ${v.titleMatchScore?.toFixed(2)})`,
    );
    run.check('Money held, not sent', p.state === 'HELD', p.state);
    run.check('Reason recorded on the payment', /TITLE/.test(p.holdReason ?? ''), p.holdReason ?? 'none');
    return `HELD: "${p.titleFetched}" ≠ "${p.creditorName}". No money left the program account.`;
  },
};

const makerChecker: Scenario = {
  id: 'pay-maker-checker',
  challenge: 'PAY',
  title: 'Four eyes (maker-checker)',
  proves: 'No single person can move money: whoever releases a held payout cannot also approve it.',
  async run({ api, run }) {
    const officer = await api.as('officer');
    const officer2 = await api.as('officer2');
    const held =
      items<{ id: string; state: string }>((await api.call('GET', '/payments?state=HELD', { token: officer })).body).find(
        (p) => p.state === 'HELD',
      ) ??
      (await (async () => {
        const c = await claimFor(api, run, FAMILIES.nasreen, { alias: MULE_ALIAS });
        await ensureApproved(api, run, c);
        return waitForPayment(api, c.id, ['HELD']);
      })());
    await run.step('Officer Kamran releases the held payout (maker)', () => api.call('POST', `/payments/${held.id}/release`, { token: officer2, body: { note: 'Called the family' } }), (r) => `HTTP ${r.status} → ${r.body?.state}`);
    const self = await run.step('Kamran tries to approve his own release', () => api.call('POST', `/payments/${held.id}/approve`, { token: officer2, body: {} }), (r) => `HTTP ${r.status}: ${r.body?.message}`);
    run.check('Self-approval blocked', self.status === 403);
    const other = await run.step('Officer Sana (a different person) approves', () => api.call('POST', `/payments/${held.id}/approve`, { token: officer, body: {} }), (r) => `HTTP ${r.status} → ${r.body?.state}`);
    run.check('Second person can approve', other.status < 300);
    return 'Maker cannot be checker (403); a second officer approved.';
  },
};

const reconciliation: Scenario = {
  id: 'pay-reconciliation',
  challenge: 'PAY',
  title: 'Reconciliation (do the books match?)',
  proves: 'Our double-entry ledger is matched against the bank statement every run, and a duplicate settlement by the bank is caught.',
  async run({ api, run }) {
    const admin = await api.as('admin');
    const balances = await run.step('Ledger balances', () => api.call('GET', '/ledger/balances', { token: admin }), (r) => `balanced = ${r.body?.balanced}, ${r.body?.entries} entries`);
    run.check('Debits equal credits', balances.body?.balanced === true);
    const settled = await waitFor(
      async () => items<{ state: string }>((await api.call('GET', '/payments?state=SUCCESS', { token: admin })).body).length > 0,
      'at least one settled payout (run another payout scenario first)',
      5_000,
    ).catch(() => false);
    if (!settled) {
      const c = await claimFor(api, run, FAMILIES.zainab);
      await ensureApproved(api, run, c);
      await waitForPayment(api, c.id, ['SUCCESS']);
    }
    const clean = await run.step('Reconcile against the Raast statement', () => api.call('POST', '/reconciliation/run', { token: admin, body: {} }), (r) => `${r.body?.matched} matched, ${r.body?.mismatched} mismatched`);
    run.check('Clean run matches', clean.body?.mismatched === 0, `${clean.body?.mismatched} mismatched`);
    await setRaastFault(api, 'duplicate_statement', 1);
    try {
      const dirty = await run.step(
        'Bank statement shows one transfer twice (injected)',
        () => api.call('POST', '/reconciliation/run', { token: admin, body: {} }),
        (r) => `${r.body?.mismatched} mismatched: ${items<{ status: string }>(r.body?.items).filter((i) => i.status !== 'matched').map((i) => i.status).join(', ')}`,
      );
      run.check('Duplicate settlement caught', items<{ status: string }>(dirty.body?.items).some((i) => i.status === 'duplicate_in_provider'));
    } finally {
      await setRaastFault(api, 'none', 0);
    }
    return 'Ledger balanced; clean statement matches; a duplicate bank settlement is flagged.';
  },
};

export const PAYMENT_SCENARIOS: Scenario[] = [raastTimeout, doublePayment, muleAccount, makerChecker, reconciliation];
