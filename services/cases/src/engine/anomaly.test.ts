import assert from 'node:assert/strict';
import test from 'node:test';
import { detectAnomalies, type AnomalyObservation } from './anomaly';

const now = new Date('2026-11-21T12:00:00.000Z');
const tenant = '00000000-0000-4000-8000-000000000001';

function row(n: number, overrides: Partial<AnomalyObservation> = {}): AnomalyObservation {
  return {
    tenantId: tenant,
    caseId: `case-${n}`,
    status: 'IN_REVIEW',
    personId: `person-${n}`,
    cnicHash: `hash-${n}`,
    nameNormalized: `name ${n}`,
    district: 'Thatta',
    payoutKey: `alias-${n}`,
    helperId: null,
    householdSize: 4,
    createdAt: new Date(now.getTime() - 1000),
    ...overrides,
  };
}

test('shared payout flags only after more than two distinct CNIC hashes', () => {
  const two = [row(1, { payoutKey: 'alias-shared' }), row(2, { payoutKey: 'alias-shared' })];
  assert.equal(
    detectAnomalies(tenant, two, now).some((x) => x.type === 'shared_payout'),
    false,
  );
  const three = [...two, row(3, { payoutKey: 'alias-shared' })];
  const signal = detectAnomalies(tenant, three, now).find((x) => x.type === 'shared_payout');
  assert.equal(signal?.observedCount, 3);
  assert.deepEqual(signal?.evidenceCaseIds, ['case-1', 'case-2', 'case-3']);
  const retries = [1, 2, 3].map((i) =>
    row(i, { cnicHash: 'same-person', payoutKey: 'alias-shared' }),
  );
  assert.equal(
    detectAnomalies(tenant, retries, now).some((x) => x.type === 'shared_payout'),
    false,
  );
});

test('helper velocity uses a strict greater-than boundary and one-hour window', () => {
  const five = Array.from({ length: 5 }, (_, i) =>
    row(i + 1, { helperId: 'helper-1', payoutKey: null }),
  );
  assert.equal(
    detectAnomalies(tenant, five, now).some((x) => x.type === 'helper_velocity'),
    false,
  );
  const six = [...five, row(6, { helperId: 'helper-1', payoutKey: null })];
  assert.equal(
    detectAnomalies(tenant, six, now).find((x) => x.type === 'helper_velocity')?.observedCount,
    6,
  );
  const old = six.map((x) => ({ ...x, createdAt: new Date(now.getTime() - 60 * 60_000 - 1) }));
  assert.equal(
    detectAnomalies(tenant, old, now).some((x) => x.type === 'helper_velocity'),
    false,
  );
});

test('household pattern requires five distinct people in the same district and size within 24 hours', () => {
  const four = Array.from({ length: 4 }, (_, i) =>
    row(i + 1, { district: 'Thatta', householdSize: 6 }),
  );
  assert.equal(
    detectAnomalies(tenant, four, now).some((x) => x.type === 'household_pattern'),
    false,
  );
  const five = [...four, row(5, { district: 'Thatta', householdSize: 6 })];
  assert.equal(
    detectAnomalies(tenant, five, now).find((x) => x.type === 'household_pattern')?.observedCount,
    5,
  );
  const differentDistrict = five.map((x, i) => ({
    ...x,
    district: i === 4 ? 'Badin' : x.district,
  }));
  assert.equal(
    detectAnomalies(tenant, differentDistrict, now).some((x) => x.type === 'household_pattern'),
    false,
  );
});

test('same-name, same-district people need two corroborating details; distinct Zainabs do not flag', () => {
  const zainabs = [
    row(1, {
      nameNormalized: 'zainab bibi',
      district: 'Thatta',
      payoutKey: 'alias-1',
      householdSize: 5,
    }),
    row(2, {
      nameNormalized: 'zainab bibi',
      district: 'Badin',
      payoutKey: 'alias-2',
      householdSize: 4,
    }),
  ];
  assert.equal(
    detectAnomalies(tenant, zainabs, now).some((x) => x.type === 'identity_collision'),
    false,
  );
  const sameNameSameDistrict = [
    row(1, {
      nameNormalized: 'zainab bibi',
      district: 'Thatta',
      payoutKey: 'alias-shared',
      householdSize: 5,
    }),
    row(2, {
      nameNormalized: 'zainab bibi',
      district: 'Thatta',
      payoutKey: 'alias-shared',
      householdSize: 5,
    }),
  ];
  assert.equal(
    detectAnomalies(tenant, sameNameSameDistrict, now).find((x) => x.type === 'identity_collision')
      ?.observedCount,
    2,
  );
  const oneDetail = sameNameSameDistrict.map((x, i) => ({
    ...x,
    householdSize: i === 0 ? 5 : 6,
    helperId: null,
  }));
  assert.equal(
    detectAnomalies(tenant, oneDetail, now).some((x) => x.type === 'identity_collision'),
    false,
  );
});

test('repeat evaluation is deterministic and does not count the same case twice', () => {
  const observations = [
    row(1, { payoutKey: 'alias-shared' }),
    row(2, { payoutKey: 'alias-shared' }),
    row(3, { payoutKey: 'alias-shared' }),
  ];
  const first = detectAnomalies(tenant, observations, now);
  const retry = detectAnomalies(tenant, [...observations, observations[0]!], now);
  assert.deepEqual(retry, first);
});

test('SQL candidate allowlists gate pure evidence checks without changing the signal threshold', () => {
  const observations = [
    row(1, { payoutKey: 'alias-shared' }),
    row(2, { payoutKey: 'alias-shared' }),
    row(3, { payoutKey: 'alias-shared' }),
  ];
  const candidates = {
    shared_payout: new Set(['alias-shared']),
    helper_velocity: new Set<string>(),
    household_pattern: new Set<string>(),
    identity_collision: new Set<string>(),
  };
  assert.equal(
    detectAnomalies(tenant, observations, now, undefined, candidates)[0]?.type,
    'shared_payout',
  );
  assert.equal(
    detectAnomalies(tenant, observations, now, undefined, {
      ...candidates,
      shared_payout: new Set(),
    }).length,
    0,
  );
});

test('tenant isolation and terminal statuses prevent cross-tenant or settled evidence from creating findings', () => {
  const data = [
    row(1, { payoutKey: 'shared' }),
    row(2, { payoutKey: 'shared', tenantId: 'other-tenant' }),
    row(3, { payoutKey: 'shared', status: 'CLOSED' }),
    row(4, { payoutKey: 'shared', status: 'REJECTED' }),
  ];
  assert.equal(detectAnomalies(tenant, data, now).length, 0);
});
