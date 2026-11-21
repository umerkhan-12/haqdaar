import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSeed, DEMO_SCENARIOS } from './data/seed-data';
import { RailsStore, TIMEOUT_DELAY_MS, type TransferRequest } from './rails.store';

const NOW = new Date('2026-11-21T10:00:00Z');
const store = () => new RailsStore(buildSeed(), () => NOW);

const transfer = (id: string, creditor: TransferRequest['creditor'] = { name: 'Zainab Bibi', alias: '03001110001' }): TransferRequest => ({
  endToEndId: id,
  amount: 12_000,
  currency: 'PKR',
  debtor: { name: 'SAHARA RELIEF PROGRAM', iban: 'PK00SAHA0000000000000001' },
  creditor,
  remittanceInfo: 'Sahara Nov 2026',
});

test('seed is deterministic and contains the contract people and mule', () => {
  assert.deepEqual(buildSeed(), buildSeed());
  const s = store();
  assert.equal(s.titleFetch({ iban: 'PK36SAHA0000001234567890' }).accountTitle, 'ZAINAB BIBI');
  assert.equal(s.titleFetch({ alias: '+92 300 9990000' }).accountTitle, 'MUHAMMAD ASLAM');
  assert.equal(s.titleFetch({ alias: '03001110001' }).ibanMasked, 'PK36SAHA************7890');
});

test('the same endToEndId is settled once, whatever happens next', () => {
  const s = store();
  const first = s.transfer(transfer('E2E-0001'));
  const again = s.transfer({ ...transfer('E2E-0001'), amount: 99_999 });
  assert.equal(first.result.status, 'ACSC');
  assert.deepEqual(again.result, first.result);
  assert.equal(s.statement('2026-11-21').entries.length, 1);
  assert.equal(s.statement('2026-11-21').entries[0]!.amount, 12_000);
});

test('unknown creditor is rejected and remembered', () => {
  const s = store();
  const r = s.transfer(transfer('E2E-0002', { name: 'X', alias: '03119876543' }));
  assert.equal(r.result.status, 'RJCT');
  assert.equal(s.status('E2E-0002').status, 'RJCT');
  assert.equal(s.statement('2026-11-21').entries.length, 0);
});

test('fail fault rejects without settling, so a retry with the same id succeeds', () => {
  const s = store();
  s.setFaults({ raast: { mode: 'fail', remaining: 1 } });
  assert.equal(s.transfer(transfer('E2E-0003')).result.status, 'RJCT');
  assert.equal(s.status('E2E-0003').status, 'NOT_FOUND');
  assert.equal(s.getFaults().raast.mode, 'none');
  assert.equal(s.transfer(transfer('E2E-0003')).result.status, 'ACSC');
});

test('timeout delays and settles nothing; inquiry says NOT_FOUND', () => {
  const s = store();
  s.setFaults({ raast: { mode: 'timeout', remaining: 1 } });
  const r = s.transfer(transfer('E2E-0004'));
  assert.equal(r.delayMs, TIMEOUT_DELAY_MS);
  assert.equal(s.status('E2E-0004').status, 'NOT_FOUND');
});

test('timeout_after_debit settles, delays the answer, and inquiry finds it (paid exactly once)', () => {
  const s = store();
  s.setFaults({ raast: { mode: 'timeout_after_debit', remaining: 1 } });
  const r = s.transfer(transfer('E2E-0005'));
  assert.equal(r.delayMs, TIMEOUT_DELAY_MS);
  assert.equal(s.status('E2E-0005').status, 'ACSC');
  assert.equal(s.transfer(transfer('E2E-0005')).delayMs, 0);
  assert.equal(s.statement('2026-11-21').entries.length, 1);
});

test('duplicate_statement repeats one entry once, then stops', () => {
  const s = store();
  s.transfer(transfer('E2E-0006'));
  s.setFaults({ raast: { mode: 'duplicate_statement', remaining: 1 } });
  assert.equal(s.statement('2026-11-21').entries.length, 2);
  assert.equal(s.statement('2026-11-21').entries.length, 1);
});

test('NADRA: name variants match, different names do not, deceased is reported', () => {
  const s = store();
  const urdu = s.verifyNadra(DEMO_SCENARIOS.urduScriptRecord.cnic, DEMO_SCENARIOS.urduScriptRecord.saysName);
  assert.equal(urdu.match, true);
  const wrong = s.verifyNadra('4220112345674', 'Muhammad Aslam');
  assert.equal(wrong.match, false);
  assert.equal(wrong.record?.fullName, 'Zainab Bibi');
  assert.equal(s.verifyNadra(DEMO_SCENARIOS.deceased).record?.deceased, true);
  assert.deepEqual(s.verifyNadra('99999-9999999-9'), { match: false, nameScore: null, record: null });
});
