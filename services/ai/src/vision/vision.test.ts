import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  documentCheck,
  UnsupportedImageError,
  type CheckId,
  type DocumentCheckResult,
} from './document-check';
import {
  buildFixtures,
  FIXTURE_CNIC,
  NUMBER_BOX,
  CARD,
  OTHER_CNIC,
  ZAINAB,
  type CardSpec,
  type FixtureName,
} from './fixtures';
import { sniff } from './image';
import { OcrEngine, parseCardText } from './readers';

/** What OCR returns for a card, so non-OCR checks are tested deterministically. */
const linesOf = (c: CardSpec) => [
  'SAMPLE IDENTITY CARD NOT A REAL CNIC',
  'Name',
  c.name,
  'Father Name',
  c.fatherName,
  'Gender Country of Stay',
  `${c.gender} Pakistan`,
  'Identity Number Date of Birth',
  `${c.cnic} ${c.dateOfBirth}`,
  'Date of Issue Date of Expiry',
  `${c.dateOfIssue} ${c.dateOfExpiry}`,
];
const fakeOcr = (c: CardSpec) => async () => linesOf(c);
const NOW = new Date('2026-11-21T00:00:00Z');

let fx: Record<FixtureName, Buffer>;
before(async () => {
  fx = await buildFixtures();
});

const failed = (r: DocumentCheckResult) =>
  r.checks
    .filter((c) => !c.ok)
    .map((c) => c.id)
    .sort();
const run = (name: FixtureName, card: CardSpec = ZAINAB, typed?: string) =>
  documentCheck(fx[name], typed, { ocr: fakeOcr(card), now: NOW });

test('magic bytes decide the type, not the name', () => {
  assert.equal(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'jpeg');
  assert.equal(sniff(Buffer.from('\x89PNG\r\n\x1a\n....', 'latin1')), 'png');
  assert.equal(sniff(Buffer.from('GIF89a......')), null);
  assert.equal(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
});

test('non-images and corrupt images are refused before any analysis', async () => {
  const ocr = async () => [];
  await assert.rejects(
    documentCheck(Buffer.from('%PDF-1.7 not an image'), undefined, { ocr }),
    UnsupportedImageError,
  );
  const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
  await assert.rejects(documentCheck(corrupt, undefined, { ocr }), UnsupportedImageError);
});

test('OCR text: every front-side field, with letter/digit confusions repaired', () => {
  const f = parseCardText([
    'Name',
    'Zainab Bibi',
    'Father Name \\ ©',
    'Allah Ditta',
    'Gender Country of Stay',
    'F Pakistan',
    'Identity Number Date of Birth',
    '422O1-1234S67-4 01.01.1980',
    'Date of Issue Date of Expiry',
    '15.03.2021 15.03.2031',
  ]);
  assert.deepEqual(f, {
    cnic: FIXTURE_CNIC,
    name: 'Zainab Bibi',
    fatherName: 'Allah Ditta',
    gender: 'F',
    dateOfBirth: '01.01.1980',
    dateOfIssue: '15.03.2021',
    dateOfExpiry: '15.03.2031',
  });
});

test('genuine photo (JPEG and PNG): every check passes, no human needed', async () => {
  for (const name of ['genuine', 'genuinePng'] as const) {
    const r = await run(name, ZAINAB, FIXTURE_CNIC);
    assert.deepEqual(failed(r), [], name);
    assert.equal(r.cnicFromQr, FIXTURE_CNIC);
    assert.equal(r.needsHuman, false);
    assert.equal(r.retakeRequired, false);
    assert.ok(r.forgeryScore < 0.5, `${name} forgery ${r.forgeryScore}`);
    assert.deepEqual(r.fields?.name, 'Zainab Bibi');
  }
});

test('tampered: pasted number region is located by ELA, and disagrees with the QR', async () => {
  const r = await run('tampered', { ...ZAINAB, cnic: OTHER_CNIC }, FIXTURE_CNIC);
  assert.deepEqual(failed(r), ['compression_consistent', 'ocr_matches_qr', 'typed_matches_card']);
  assert.ok(r.forgeryScore >= 0.5);
  assert.equal(r.editedRegions.length, 1);
  const [box] = r.editedRegions;
  const cx = (box!.x + box!.width / 2) * CARD.width;
  const cy = (box!.y + box!.height / 2) * CARD.height;
  assert.ok(
    cx > NUMBER_BOX.left && cx < NUMBER_BOX.left + NUMBER_BOX.width,
    `region centre x ${cx}`,
  );
  assert.ok(
    cy > NUMBER_BOX.top && cy < NUMBER_BOX.top + NUMBER_BOX.height,
    `region centre y ${cy}`,
  );
  assert.equal(r.needsHuman, true);
  assert.equal(r.retakeRequired, false);
});

test('blurred: retake requested, nothing read, nobody accused of a typing mistake', async () => {
  const r = await documentCheck(fx.blurred, FIXTURE_CNIC, {
    ocr: async () => ['', '—— -—'],
    now: NOW,
  });
  assert.deepEqual(failed(r), ['cnic_read', 'sharp_enough']);
  assert.ok(r.blurScore >= 0.5);
  assert.equal(r.retakeRequired, true);
  assert.equal(r.needsHuman, true);
  assert.match(r.explanationEn, /take the photo again/);
});

test('edited EXIF: editing software flagged, image itself is clean', async () => {
  const r = await run('editedExif', ZAINAB, FIXTURE_CNIC);
  assert.deepEqual(failed(r), ['no_editor_software']);
  assert.match(r.checks.find((c) => c.id === 'no_editor_software')!.detail, /Photoshop/);
  assert.equal(r.needsHuman, true);
});

test('mismatched QR: printed and QR numbers differ; typed matches what is printed', async () => {
  const r = await run('mismatchedQr', ZAINAB, FIXTURE_CNIC);
  assert.deepEqual(failed(r), ['ocr_matches_qr']);
  assert.equal(r.cnicFromQr, OTHER_CNIC);
});

test('typed CNIC differs from the card → human review', async () => {
  const r = await run('genuine', ZAINAB, OTHER_CNIC);
  assert.deepEqual(failed(r), ['typed_matches_card']);
  assert.match(r.explanationEn, /not been rejected/);
});

test('expired card → human review, never a rejection', async () => {
  const r = await run('expired', {
    ...ZAINAB,
    dateOfIssue: '10.02.2012',
    dateOfExpiry: '10.02.2022',
  });
  assert.deepEqual(failed(r), ['card_not_expired']);
});

test('Kill AI: checks still run, but an officer reviews every document', async () => {
  const r = await documentCheck(fx.genuine, FIXTURE_CNIC, {
    ocr: fakeOcr(ZAINAB),
    killed: true,
    now: NOW,
  });
  assert.deepEqual(failed(r), ['ai_available' satisfies CheckId]);
  assert.equal(r.needsHuman, true);
});

// Real Tesseract on the rendered cards. Needs the English model (downloaded once from the
// jsdelivr CDN); skipped, not failed, when it cannot be fetched.
const engine = new OcrEngine();
after(() => engine.terminate());

const digitsMatching = (a: string | null, b: string) =>
  a ? [...b.replace(/-/g, '')].filter((d, i) => a.replace(/-/g, '')[i] === d).length : 0;

test('real OCR reads the printed number and name', { timeout: 180_000 }, async (t) => {
  const probe = await engine.readLines(fx.genuinePng, 120_000);
  if (!probe) return t.skip('Tesseract English model unavailable (offline?)');
  const ocr = (png: Buffer) => engine.readLines(png, 60_000);
  for (const [name, expected] of [
    ['genuine', FIXTURE_CNIC],
    ['tampered', OTHER_CNIC],
  ] as const) {
    const r = await documentCheck(fx[name], undefined, { ocr, now: NOW });
    assert.ok(digitsMatching(r.cnicFromOcr, expected) >= 12, `${name}: OCR read ${r.cnicFromOcr}`);
    assert.match(r.fields?.name ?? '', /zainab/i);
  }
});
