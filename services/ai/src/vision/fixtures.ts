import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import QRCode from 'qrcode';
import sharp, { type Sharp } from 'sharp';

/**
 * Synthetic sample cards for tests and demos. Same field layout, labels and date format as a
 * Pakistani CNIC (so OCR is tested on realistic input), but no emblem, issuer marks or security
 * features, and stamped as a sample. Numbers are the synthetic ones from docs/CONTRACTS.md.
 */
export const CARD = { width: 1000, height: 630 };
/** Where the identity number is printed (pixels on the card). */
export const NUMBER_BOX = { left: 30, top: 392, width: 290, height: 46 };

export const FIXTURE_CNIC = '42201-1234567-4';
export const OTHER_CNIC = '42201-7654321-2';

export interface CardSpec {
  name: string;
  fatherName: string;
  gender: 'M' | 'F';
  cnic: string;
  dateOfBirth: string;
  dateOfIssue: string;
  dateOfExpiry: string;
  qrCnic?: string;
}

export const ZAINAB: CardSpec = {
  name: 'Zainab Bibi',
  fatherName: 'Allah Ditta',
  gender: 'F',
  cnic: FIXTURE_CNIC,
  dateOfBirth: '01.01.1980',
  dateOfIssue: '15.03.2021',
  dateOfExpiry: '15.03.2031',
};

const RASHIDA: CardSpec = {
  ...ZAINAB,
  name: 'Rashida Begum',
  fatherName: 'Ghulam Nabi',
  cnic: OTHER_CNIC,
};

const field = (x: number, y: number, label: string, value: string) => `
  <text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="19" fill="#2f5d3f">${label}</text>
  <text x="${x}" y="${y + 34}" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="#111">${value}</text>`;

function cardSvg(c: CardSpec): string {
  const guilloche = Array.from({ length: 34 }, (_, i) => {
    const y = 70 + i * 17;
    return `<path d="M0 ${y} Q 250 ${y - 22} 500 ${y} T 1000 ${y}" stroke="#bfe0c8" stroke-width="1.1" fill="none"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.width}" height="${CARD.height}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#e3f2e6"/><stop offset="1" stop-color="#cfe8d6"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="#ffffff"/>
  <rect width="100%" height="100%" rx="28" fill="url(#bg)"/>
  ${guilloche}
  <rect x="0" y="0" width="${CARD.width}" height="78" rx="28" fill="#0f6b3a"/>
  <rect x="0" y="50" width="${CARD.width}" height="28" fill="#0f6b3a"/>
  <text x="36" y="51" font-family="Arial, sans-serif" font-size="30" font-weight="bold" fill="#ffffff">SAMPLE IDENTITY CARD</text>
  <text x="964" y="51" text-anchor="end" font-family="Arial, sans-serif" font-size="24" font-weight="bold" fill="#ffd2d2">NOT A REAL CNIC</text>
  ${field(40, 125, 'Name', c.name)}
  ${field(40, 210, 'Father Name', c.fatherName)}
  ${field(40, 295, 'Gender', c.gender)}
  ${field(360, 295, 'Country of Stay', 'Pakistan')}
  ${field(40, 380, 'Identity Number', c.cnic)}
  ${field(360, 380, 'Date of Birth', c.dateOfBirth)}
  ${field(40, 465, 'Date of Issue', c.dateOfIssue)}
  ${field(360, 465, 'Date of Expiry', c.dateOfExpiry)}
  <path d="M60 585 q 20 -30 40 0 t 40 0 t 50 -10" stroke="#1b2a6b" stroke-width="2.5" fill="none"/>
  <text x="40" y="612" font-family="Arial, sans-serif" font-size="16" fill="#2f5d3f">Holder's Signature</text>
  <rect x="740" y="100" width="210" height="250" fill="#b9cbbf" stroke="#5f7a68" stroke-width="2"/>
  <circle cx="845" cy="190" r="48" fill="#9fb5a7"/>
  <rect x="775" y="250" width="140" height="100" rx="60" fill="#9fb5a7"/>
  <text x="845" y="232" text-anchor="middle" transform="rotate(-20 845 232)" font-family="Arial, sans-serif" font-size="34" font-weight="bold" fill="#c0392b" fill-opacity="0.75">SAMPLE</text>
</svg>`;
}

/** Lossless card with a QR encoding `qrCnic ?? cnic`. */
async function renderCard(c: CardSpec): Promise<Buffer> {
  const qr = await QRCode.toBuffer(`HAQDAAR-SAMPLE|CNIC:${c.qrCnic ?? c.cnic}`, {
    width: 220,
    margin: 2,
    errorCorrectionLevel: 'M',
  });
  return sharp(Buffer.from(cardSvg(c)))
    .composite([{ input: qr, left: 735, top: 375 }])
    .png()
    .toBuffer();
}

/** "Phone photo": JPEG at camera-like quality with camera EXIF. */
const asPhoto = (img: Buffer | Sharp, software?: string) =>
  (Buffer.isBuffer(img) ? sharp(img) : img)
    .withExif({ IFD0: { Make: 'HaqdaarSim', Model: 'Fixture', ...(software ? { Software: software } : {}) } })
    .jpeg({ quality: 75 })
    .toBuffer();

export type FixtureName = 'genuine' | 'genuinePng' | 'tampered' | 'blurred' | 'editedExif' | 'mismatchedQr' | 'expired';

export async function buildFixtures(): Promise<Record<FixtureName, Buffer>> {
  const card = await renderCard(ZAINAB);
  const genuine = await asPhoto(card);

  // Number region pasted from a different, freshly rendered card, then saved once more.
  const patch = await sharp(await renderCard(RASHIDA)).extract(NUMBER_BOX).png().toBuffer();
  const tampered = await sharp(genuine)
    .composite([{ input: patch, left: NUMBER_BOX.left, top: NUMBER_BOX.top }])
    .jpeg({ quality: 95 })
    .toBuffer();

  return {
    genuine,
    genuinePng: card,
    tampered,
    blurred: await asPhoto(sharp(card).blur(5)),
    editedExif: await asPhoto(card, 'Adobe Photoshop 25.1 (Windows)'),
    mismatchedQr: await asPhoto(await renderCard({ ...ZAINAB, qrCnic: OTHER_CNIC })),
    expired: await asPhoto(await renderCard({ ...ZAINAB, dateOfIssue: '10.02.2012', dateOfExpiry: '10.02.2022' })),
  };
}

/** `node dist/vision/fixtures.js [outDir]` writes the fixtures for manual testing. */
if (require.main === module) {
  const dir = process.argv[2] ?? join(tmpdir(), 'haqdaar-cnic-fixtures');
  mkdirSync(dir, { recursive: true });
  void buildFixtures().then((all) => {
    for (const [name, buf] of Object.entries(all)) {
      writeFileSync(join(dir, `${name}.${name === 'genuinePng' ? 'png' : 'jpg'}`), buf);
    }
    console.log(`Wrote ${Object.keys(all).length} fixtures to ${dir}`);
  });
}
