import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_ANOMALY_THRESHOLDS,
  detectAnomalies,
  detectAnomaliesForCase,
  flagsVisibleTo,
  type AnomalyObservation,
} from './anomaly';

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

test('helper velocity counts distinct people, with a strict greater-than boundary and a one-hour window', () => {
  const limit = DEFAULT_ANOMALY_THRESHOLDS.helperClaimsPerHour;
  const atLimit = Array.from({ length: limit }, (_, i) =>
    row(i + 1, { helperId: 'helper-1', payoutKey: null }),
  );
  assert.equal(
    detectAnomalies(tenant, atLimit, now).some((x) => x.type === 'helper_velocity'),
    false,
  );
  const over = [...atLimit, row(limit + 1, { helperId: 'helper-1', payoutKey: null })];
  assert.equal(
    detectAnomalies(tenant, over, now).find((x) => x.type === 'helper_velocity')?.observedCount,
    limit + 1,
  );
  const old = over.map((x) => ({ ...x, createdAt: new Date(now.getTime() - 60 * 60_000 - 1) }));
  assert.equal(
    detectAnomalies(tenant, old, now).some((x) => x.type === 'helper_velocity'),
    false,
  );
});

test('a helper who files many claims for the same few families is not flagged', () => {
  // Judge Mode and a busy shop: one helper, seven families, dozens of claims in an hour.
  const busy = Array.from({ length: 60 }, (_, i) =>
    row(i + 1, {
      helperId: 'helper-1',
      payoutKey: null,
      cnicHash: `family-${i % 7}`,
      personId: `family-${i % 7}`,
      district: `d-${i % 7}`,
    }),
  );
  assert.deepEqual(detectAnomalies(tenant, busy, now), []);
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

// ---------- submit path: one claim, only the rows that share a key with it ----------

test('the two Zainabs: same name and district, different CNIC and different details, are not flagged', () => {
  const zainabs = [
    row(1, {
      nameNormalized: 'zainab bibi',
      district: 'Thatta',
      payoutKey: 'alias-1',
      householdSize: 5,
      helperId: null,
    }),
    row(2, {
      nameNormalized: 'zainab bibi',
      district: 'Thatta',
      payoutKey: 'alias-2',
      householdSize: 4,
      helperId: null,
    }),
  ];
  assert.deepEqual(detectAnomalies(tenant, zainabs, now), []);
  assert.deepEqual(detectAnomaliesForCase(tenant, 'case-1', zainabs, now), []);
  assert.deepEqual(detectAnomaliesForCase(tenant, 'case-2', zainabs, now), []);

  // One shared detail (they used the same helper) is still not enough.
  const sameHelper = zainabs.map((x) => ({ ...x, helperId: 'helper-1' }));
  assert.deepEqual(detectAnomaliesForCase(tenant, 'case-2', sameHelper, now), []);
});

test('a clean claim among unrelated claims gets no anomaly flag', () => {
  const others = Array.from({ length: 40 }, (_, i) =>
    row(i + 10, {
      district: `district-${i}`,
      householdSize: (i % 9) + 1,
      helperId: i % 2 ? 'helper-1' : null,
      cnicHash: `p-${i % 6}`,
    }),
  );
  const clean = row(1, {
    nameNormalized: 'nasreen bibi',
    district: 'Karachi West',
    householdSize: 8,
    helperId: 'helper-1',
  });
  assert.deepEqual(detectAnomaliesForCase(tenant, clean.caseId, [clean, ...others], now), []);
});

test('the claim that completes a ring is flagged with every ring claim as evidence, and nothing else', () => {
  const ring = [1, 2, 3].map((n) => row(n, { payoutKey: 'mule', district: `ring-${n}` }));
  // Rows fetched for another key of case-3 (same name + district) plus an unrelated ring it is not part of.
  const sameName = row(4, { nameNormalized: ring[2]!.nameNormalized, district: ring[2]!.district });
  const otherRing = [5, 6, 7].map((n) =>
    row(n, { payoutKey: 'other-mule', district: `other-${n}` }),
  );
  const fetched = [...ring, sameName, ...otherRing, ring[0]!]; // the lookups overlap: duplicates are harmless
  const found = detectAnomaliesForCase(tenant, 'case-3', fetched, now);
  assert.deepEqual(
    found.map((x) => x.type),
    ['shared_payout'],
  );
  assert.deepEqual(found[0]!.evidenceCaseIds, ['case-1', 'case-2', 'case-3']);
  // The first two ring claims, on their own, were under the threshold: same outcome as before.
  assert.deepEqual(detectAnomaliesForCase(tenant, 'case-2', ring.slice(0, 2), now), []);
});

test('anomaly flags are shown to staff and removed for citizens and helpers', () => {
  const flags = [
    'duplicate_claim_this_month',
    'anomaly:shared_payout',
    'anomaly:identity_collision',
  ];
  assert.deepEqual(flagsVisibleTo(flags, true), flags);
  assert.deepEqual(flagsVisibleTo(flags, false), ['duplicate_claim_this_month']);
  assert.deepEqual(flagsVisibleTo(['anomaly:helper_velocity'], false), []);
});
