import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateScamMap, type ScamRow } from './scam-map';

const NOW = new Date('2026-11-22T10:00:00.000Z'); // 15:00 in Pakistan
const R1 = '11111111-1111-4111-8111-111111111111';
const R2 = '22222222-2222-4222-8222-222222222222';

const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000);
const checked = (
  hoursAgo: number,
  verdict: string,
  redFlags: string[],
  district: string | null,
  sealValid: boolean | null = null,
): ScamRow => ({
  type: 'ai.scam.checked',
  occurredAt: at(hoursAgo),
  payload: { verdict, confidence: 0.9, redFlags, sealValid, district, channel: 'citizen' },
});

const ROWS: ScamRow[] = [
  checked(1, 'SCAM', ['asks_secret', 'prize'], 'Thatta'),
  checked(2, 'SCAM', ['prize', 'asks_secret'], 'Thatta'),
  checked(3, 'SCAM', ['link'], 'Badin'),
  checked(4, 'GENUINE', [], 'Thatta', true),
  checked(5, 'GENUINE', [], null),
  checked(30, 'UNSURE', ['urgency'], null),
  checked(24 * 9, 'SCAM', ['link'], 'Badin'), // outside a 7 day window
  { type: 'ai.scam.checked', occurredAt: at(1), payload: { verdict: 'MAYBE' } }, // malformed
  { type: 'ai.scam.checked', occurredAt: at(1), payload: null },
  {
    type: 'ai.scam.reported',
    occurredAt: at(6),
    payload: {
      reportId: R1,
      verdict: 'UNSURE',
      redFlags: ['urgency'],
      district: 'Thatta',
      reporterRole: 'citizen',
      text: 'call [PHONE_1]',
    },
  },
  {
    type: 'ai.scam.reported',
    occurredAt: at(5),
    payload: {
      reportId: R2,
      verdict: 'SCAM',
      redFlags: ['link'],
      district: null,
      reporterRole: 'helper',
      text: 'x',
    },
  },
  {
    type: 'ai.scam.report_resolved',
    occurredAt: at(4),
    payload: { reportId: R1, label: 'confirmed_scam' },
  },
  {
    type: 'ai.scam.report_resolved',
    occurredAt: at(3),
    payload: { reportId: R1, label: 'genuine' },
  },
];

test('scam map: counts by verdict, flag, district and combination inside the window', () => {
  const m = aggregateScamMap(ROWS, { days: 7, now: NOW });
  assert.equal(m.total, 6);
  assert.deepEqual(m.byVerdict, { GENUINE: 2, SCAM: 3, UNSURE: 1 });
  assert.equal(m.genuineWithSeal, 1);
  assert.equal(m.unsureShare, 1 / 6);
  assert.deepEqual(m.byFlag, [
    { key: 'asks_secret', count: 2 },
    { key: 'prize', count: 2 },
    { key: 'link', count: 1 },
  ]);
  assert.deepEqual(m.byDistrict[0], { key: 'Thatta', count: 3 });
  assert.deepEqual(m.byDistrict[1], { key: 'Unknown', count: 2 });
  assert.deepEqual(m.topCombinations[0], { flags: ['asks_secret', 'prize'], count: 2 });
  assert.deepEqual(
    m.grid.find((g) => g.district === 'Thatta' && g.flag === 'prize'),
    { district: 'Thatta', flag: 'prize', count: 2 },
  );
});

test('scam map: days and hours are bucketed in Pakistan time, empty days included', () => {
  const m = aggregateScamMap(ROWS, { days: 7, now: NOW });
  assert.equal(m.byDay.length, 7);
  assert.deepEqual(m.byDay.at(-1), { day: '2026-11-22', total: 5, scam: 3 });
  assert.deepEqual(m.byDay.at(-2), { day: '2026-11-21', total: 1, scam: 0 });
  assert.equal(m.byDay[0]!.total, 0);
  assert.deepEqual(m.byHour[14], { hour: 14, total: 1, scam: 1 }); // 09:00Z = 14:00 PKT
  assert.equal(
    m.byHour.reduce((s, h) => s + h.total, 0),
    6,
  );
});

test('scam map: latest entries are newest first and carry no message text', () => {
  const m = aggregateScamMap(ROWS, { days: 7, now: NOW });
  assert.equal(m.latest.length, 6);
  assert.equal(m.latest[0]!.at, at(1).toISOString());
  assert.deepEqual(Object.keys(m.latest[0]!).sort(), [
    'at',
    'channel',
    'confidence',
    'district',
    'redFlags',
    'verdict',
  ]);
});

test('scam map: the latest officer label wins and a "genuine" label on a non-genuine verdict is a false alarm', () => {
  const m = aggregateScamMap(ROWS, { days: 7, now: NOW });
  assert.equal(m.reports.length, 2);
  const r1 = m.reports.find((r) => r.reportId === R1)!;
  assert.equal(r1.label, 'genuine');
  assert.equal(r1.resolvedAt, at(3).toISOString());
  assert.deepEqual(m.humanReview, {
    reported: 2,
    open: 1,
    confirmedScam: 0,
    genuine: 1,
    falseAlarms: 1,
    falseAlarmShare: 1,
  });
});

test('scam map: nothing checked → zeros, never NaN', () => {
  const m = aggregateScamMap([], { days: 3, now: NOW });
  assert.equal(m.total, 0);
  assert.equal(m.unsureShare, 0);
  assert.equal(m.humanReview.falseAlarmShare, null);
  assert.equal(m.byDay.length, 3);
  assert.deepEqual(m.latest, []);
});
