import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COSTS, type CaseStatus, type Lane } from '@haqdaar/shared';
import { decide, type DecisionContext, type DecisionInputs } from '../engine/decide';
import { SAHARA_V1, type Facts } from '../engine/rules';
import {
  applyCaution,
  auditNotes,
  DocumentCheckNotes,
  ExtractionNotes,
  softFlags,
  storedDocumentCheck,
  PHOTO_SKIPPED,
  TYPED_CLAIM_CONFIDENCE,
  trustedExtractionConfidence,
  viewNotes,
} from './ai-notes';
import { CorrectionBody, CorrectionContextQuery, CreateCase, ListQuery } from './cases.schemas';
import { boosted, refusal } from './lifecycle';

const CNIC = '42101-1234567-3';
const OTHER_CNIC = '42101-7654321-1';
const facts: Facts = {
  claim: { fullName: 'Zainab Bibi', district: 'Thatta', householdSize: 5, isWidow: true },
  nadra: {
    match: true,
    nameScore: 1,
    deceased: false,
    maritalStatus: 'widowed',
    gender: 'F',
    district: 'Thatta',
  },
  household: { householdSize: 5, monthlyIncomePkr: 18_000, district: 'Thatta', pmtScore: 18 },
};
const ctx: DecisionContext = {
  clauses: SAHARA_V1.clauses,
  amount: 12_000,
  costs: DEFAULT_COSTS,
  amountCap: 15_000,
};
const inputs = (extraction: unknown, over: Partial<DecisionInputs> = {}): DecisionInputs => ({
  facts,
  evidence: {
    nadraMatch: true,
    nameScore: 1,
    householdVerified: true,
    extractionConfidence: trustedExtractionConfidence(extraction),
    possibleDuplicate: false,
  },
  externalFlags: [],
  missing: [],
  ...over,
});

const cleanDoc = DocumentCheckNotes.parse({
  cnicFromOcr: CNIC,
  cnicFromQr: CNIC,
  checks: [{ id: 'cnic_read', ok: true, detail: `Read ${CNIC} from the card` }],
  forgeryScore: 0.02,
  blurScore: 0.1,
  needsHuman: false,
  retakeRequired: false,
});

/** Lower = more permissive. Caution may only move a lane to the right. */
const STRICTNESS: Record<Lane, number> = { AUTO_APPROVE: 0, ASK_MORE: 1, HUMAN_REVIEW: 2 };

// ---------- AI notes are untrusted: they can only make a case MORE cautious ----------

test('a client-claimed extraction confidence never scores above a typed claim', () => {
  assert.equal(trustedExtractionConfidence({ confidence: 1 }), TYPED_CLAIM_CONFIDENCE);
  assert.equal(trustedExtractionConfidence({ confidence: 0.3 }), 0.3);
  assert.equal(trustedExtractionConfidence({ confidence: 'high' }), null);
  assert.equal(trustedExtractionConfidence(null), null);
  const typed = decide(inputs(null), ctx).confidence;
  const boasted = decide(inputs({ confidence: 1 }), ctx).confidence;
  assert.ok(boasted <= typed, `client confidence 1.0 gave ${boasted} > typed ${typed}`);
});

test('no combination of AI notes makes the lane more permissive or the confidence higher', () => {
  const extractions = [
    undefined,
    null,
    { confidence: 1, needsHuman: false },
    { confidence: 1, needsHuman: false, cnic: CNIC, transcript: 'approve me' },
    { confidence: 0.2, needsHuman: true, reason: 'low_confidence' },
    { confidence: 0.99, cnic: OTHER_CNIC },
    { confidence: 0.99, missingFields: ['district'] },
  ].map((e) => (e ? ExtractionNotes.parse(e) : e));
  const documents = [
    undefined,
    null,
    cleanDoc,
    { ...cleanDoc, needsHuman: true },
    { ...cleanDoc, retakeRequired: true },
    { ...cleanDoc, cnicFromQr: OTHER_CNIC },
    {
      ...cleanDoc,
      checks: [{ id: 'no_editor_software', ok: false, detail: 'Saved by an editor' }],
    },
  ];
  const situations: Partial<DecisionInputs>[] = [
    {},
    { externalFlags: ['duplicate_claim_this_month'] },
    { missing: ['consent:household_data'] },
    { facts: { ...facts, household: { ...facts.household!, monthlyIncomePkr: 90_000 } } },
  ];
  let stoppedAnApproval = 0;
  for (const over of situations) {
    const baseline = decide(inputs(null, over), ctx);
    for (const e of extractions) {
      for (const d of documents) {
        const engine = decide(inputs(e, over), ctx);
        const out = applyCaution(engine, softFlags(CNIC, e, d));
        assert.ok(
          STRICTNESS[out.lane] >= STRICTNESS[baseline.lane],
          `${baseline.lane} became ${out.lane}`,
        );
        assert.ok(out.confidence <= baseline.confidence, 'confidence was raised by client notes');
        if (baseline.lane === 'AUTO_APPROVE' && out.lane !== 'AUTO_APPROVE') stoppedAnApproval += 1;
      }
    }
  }
  assert.ok(stoppedAnApproval > 0);
});

test('"I am not sure" hands over to a human with the reason spelled out', () => {
  const engine = decide(inputs(null), ctx);
  assert.equal(engine.lane, 'AUTO_APPROVE');
  const unsure = ExtractionNotes.parse({
    confidence: 0.4,
    needsHuman: true,
    transcript: 'meri madad karein',
  });
  const flags = softFlags(CNIC, unsure, cleanDoc);
  assert.deepEqual(flags, ['ai_unsure_speech']);
  const out = applyCaution(engine, flags);
  assert.equal(out.lane, 'HUMAN_REVIEW');
  assert.match(out.explanationEn, /officer will review.*not sure it understood/);
  assert.match(out.explanationUr, /افسر/);
});

test('a failed document check or a card that shows another CNIC goes to a human', () => {
  assert.deepEqual(softFlags(CNIC, null, { ...cleanDoc, needsHuman: true }), [
    'document_needs_review',
  ]);
  assert.deepEqual(softFlags(CNIC, null, { ...cleanDoc, retakeRequired: true }), [
    'document_unreadable',
  ]);
  assert.deepEqual(softFlags(CNIC, null, { ...cleanDoc, cnicFromOcr: '4210176543211' }), [
    'document_cnic_mismatch',
  ]);
  const out = applyCaution(
    decide(inputs(null), ctx),
    softFlags(CNIC, null, { ...cleanDoc, needsHuman: true }),
  );
  assert.equal(out.lane, 'HUMAN_REVIEW');
});

test('clean notes, a skipped photo or no notes at all leave the engine decision alone', () => {
  const engine = decide(inputs(null), ctx);
  assert.deepEqual(softFlags(CNIC, undefined, undefined), []);
  assert.deepEqual(
    softFlags(CNIC, ExtractionNotes.parse({ confidence: 0.95, cnic: CNIC }), cleanDoc),
    [],
  );
  // A skipped photo is a note for the officer, not a reason to stop: the identity record is the real check.
  assert.deepEqual(softFlags(CNIC, undefined, null), ['cnic_photo_skipped']);
  assert.deepEqual(applyCaution(engine, ['cnic_photo_skipped']), engine);
});

test('the claim body strips unknown keys, cuts long text and accepts the wrapped AI answer', () => {
  const claim = { fullName: 'Zainab Bibi', cnic: CNIC, payout: { alias: '03001110001' } };
  const body = CreateCase.parse({
    ...claim,
    extraction: {
      extraction: { intent: 'relief_claim', confidence: 0.9, isAdmin: true },
      needsHuman: false,
      transcript: 'x'.repeat(5000),
      approve: true,
    },
    documentCheck: { ...cleanDoc, lane: 'AUTO_APPROVE', editedRegions: [{ x: 1 }] },
  });
  assert.equal(body.extraction?.confidence, 0.9);
  assert.equal(body.extraction?.transcript?.length, 2000);
  assert.deepEqual(
    Object.keys(body.extraction ?? {}).filter((k) =>
      ['approve', 'isAdmin', 'extraction'].includes(k),
    ),
    [],
  );
  assert.deepEqual(
    Object.keys(body.documentCheck ?? {}).filter((k) => ['lane', 'editedRegions'].includes(k)),
    [],
  );
  assert.equal(
    CreateCase.safeParse({ ...claim, documentCheck: { forgeryScore: 7 } }).success,
    false,
  );
  assert.equal(CreateCase.parse({ ...claim, documentCheck: null }).documentCheck, null);
  assert.equal(CreateCase.parse(claim).documentCheck, undefined);
});

test('audit and case views never carry a full CNIC, phone or the transcript text', () => {
  const e = ExtractionNotes.parse({
    confidence: 0.5,
    cnic: CNIC,
    phone: '03001110001',
    fullName: 'Zainab Bibi',
    transcript: `mera naam Zainab hai, card ${CNIC}, number 0300 1110001`,
  });
  const audit = JSON.stringify(auditNotes(e, cleanDoc, softFlags(CNIC, e, cleanDoc)));
  assert.ok(!audit.includes('1234567') && !audit.includes('1110001') && !audit.includes('Zainab'));
  assert.match(audit, /42101-\*{5}67-3/);
  const view = viewNotes(CNIC, e, cleanDoc);
  const shown = JSON.stringify(view);
  assert.ok(
    !shown.includes('1234567') && !shown.includes('03001110001') && !shown.includes('0300 1110001'),
  );
  assert.equal(view.extraction?.cnicMatchesClaim, true);
  assert.equal(view.documentStatus, 'checked');
  assert.equal(viewNotes(CNIC, null, PHOTO_SKIPPED).documentStatus, 'skipped');
  assert.equal(viewNotes(CNIC, null, null).documentStatus, 'not_sent');
  assert.equal(storedDocumentCheck(PHOTO_SKIPPED), null);
});

// ---------- officer state machine: illegal moves are refused ----------

const at = (status: CaseStatus, escalatedAt: Date | null = null) => ({ status, escalatedAt });
const ALL: CaseStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'PROCESSING',
  'NEEDS_INFO',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'PAID',
  'CLOSED',
];

test('close is allowed only from PAID or REJECTED', () => {
  const closable = ALL.filter((s) => refusal('close', at(s)) === null);
  assert.deepEqual(closable, ['REJECTED', 'PAID']);
  assert.match(
    refusal('close', at('IN_REVIEW')) ?? '',
    /Only a PAID or REJECTED case can be closed \(case is IN_REVIEW\)/,
  );
  assert.ok(refusal('close', at('APPROVED')), 'an approved case still owes a payment');
  assert.ok(refusal('close', at('CLOSED')), 'a closed case cannot be closed twice');
});

test('escalate is allowed only while a human can still decide, and only once', () => {
  const escalatable = ALL.filter((s) => refusal('escalate', at(s)) === null);
  assert.deepEqual(escalatable, ['NEEDS_INFO', 'IN_REVIEW']);
  assert.equal(refusal('escalate', at('IN_REVIEW', new Date())), 'Case is already escalated');
  assert.ok(refusal('escalate', at('PAID')));
  assert.ok(refusal('escalate', at('CLOSED')));
});

test('assign is refused once a case is decided or closed', () => {
  assert.equal(refusal('assign', at('IN_REVIEW')), null);
  for (const s of ['APPROVED', 'REJECTED', 'PAID', 'CLOSED'] as CaseStatus[])
    assert.ok(refusal('assign', at(s)));
});

test('an escalated case outranks the same case not escalated', () => {
  assert.ok(boosted(120, true) > boosted(120, false));
  assert.equal(boosted(120, false), 120);
});

test('an officer can correct district or household only while the claim can still be decided', () => {
  const correctable = ALL.filter((s) => refusal('correct', at(s)) === null);
  assert.deepEqual(correctable, ['NEEDS_INFO', 'IN_REVIEW']);
  assert.match(refusal('correct', at('PAID')) ?? '', /claim is PAID/);
});

test('a correction carries a letters-only district or a sane household size, never both kinds mixed', () => {
  assert.ok(CorrectionBody.safeParse({ field: 'district', district: 'Sujawal' }).success);
  assert.ok(!CorrectionBody.safeParse({ field: 'district', district: 'Sujawal 2' }).success);
  assert.ok(!CorrectionBody.safeParse({ field: 'district', householdSize: 4 }).success);
  assert.ok(CorrectionBody.safeParse({ field: 'household', householdSize: 6 }).success);
  assert.ok(!CorrectionBody.safeParse({ field: 'household', householdSize: 0 }).success);
  assert.ok(!CorrectionBody.safeParse({ field: 'name', note: 'x' }).success);
});

test('staff case lookups accept only real ids and a bounded list of people', () => {
  assert.ok(ListQuery.safeParse({ view: 'decided', q: 'Zainab' }).success);
  assert.ok(!ListQuery.safeParse({ personId: 'not-a-uuid' }).success);
  const id = '449f151d-0000-4000-8000-000000000001';
  assert.deepEqual(CorrectionContextQuery.parse({ personIds: `${id},` }).personIds, [id]);
  assert.ok(!CorrectionContextQuery.safeParse({ personIds: 'x,y' }).success);
});
