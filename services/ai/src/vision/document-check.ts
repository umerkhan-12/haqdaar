import { blurScore, BLUR_RETAKE, editorTag, errorLevel, type Region } from './forensics';
import { OCR_RETRY_TURNS, ocrRetryImage, prepare, sniff } from './image';
import { findCnic, parseCardText, readQr, type CardFields } from './readers';

export type CheckId =
  | 'cnic_read'
  | 'qr_read'
  | 'ocr_matches_qr'
  | 'typed_matches_card'
  | 'compression_consistent'
  | 'no_editor_software'
  | 'sharp_enough'
  | 'card_not_expired'
  | 'ai_available';

export interface Check {
  id: CheckId;
  ok: boolean;
  detail: string;
}

export interface DocumentCheckResult {
  kind: 'jpeg' | 'png';
  cnicFromOcr: string | null;
  cnicFromQr: string | null;
  fields: Omit<CardFields, 'cnic'> | null;
  checks: Check[];
  forgeryScore: number;
  blurScore: number;
  editedRegions: Region[];
  needsHuman: boolean;
  retakeRequired: boolean;
  explanationUr: string;
  explanationEn: string;
}

export interface DocumentCheckDeps {
  /** OCR lines for a lossless grayscale PNG; null when OCR is unavailable or timed out. */
  ocr: (png: Buffer) => Promise<string[] | null>;
  killed?: boolean;
  now?: Date;
}

export class UnsupportedImageError extends Error {}

/** Extra OCR passes stop starting after this long, so the citizen is never left waiting. */
const OCR_RETRY_BUDGET_MS = 14_000;

/** What a failed check means for the citizen, in plain words. */
const SAY: Record<CheckId, { ur: string; en: string }> = {
  cnic_read: { ur: 'کارڈ کا نمبر صاف نہیں پڑھا جا سکا۔', en: 'The card number could not be read.' },
  qr_read: { ur: 'کارڈ کا QR کوڈ نہیں پڑھا جا سکا۔', en: 'The QR code could not be read.' },
  ocr_matches_qr: {
    ur: 'کارڈ پر لکھا نمبر اور QR کوڈ والا نمبر مختلف ہیں۔',
    en: 'The printed number and the QR code number differ.',
  },
  typed_matches_card: {
    ur: 'آپ کا لکھا ہوا شناختی کارڈ نمبر کارڈ کے نمبر سے نہیں ملتا۔',
    en: 'The CNIC you typed does not match the card.',
  },
  compression_consistent: {
    ur: 'تصویر کا ایک حصہ باقی تصویر سے مختلف لگتا ہے۔',
    en: 'Part of the image looks different from the rest (possible edit).',
  },
  no_editor_software: {
    ur: 'یہ تصویر کسی ایڈیٹنگ ایپ سے گزری ہے۔',
    en: 'The photo was saved by an editing app.',
  },
  sharp_enough: { ur: 'تصویر دھندلی ہے۔', en: 'The photo is blurry.' },
  card_not_expired: { ur: 'کارڈ کی میعاد ختم ہو چکی ہے۔', en: 'The card has expired.' },
  ai_available: { ur: 'خودکار جانچ بند ہے۔', en: 'Automatic checks are switched off.' },
};

/**
 * Local checks on a CNIC photo. Nothing here rejects a citizen: any doubt sets `needsHuman`
 * with the reason, and a blurry or unreadable photo asks for a retake. The image never leaves
 * this process (no external model sees it).
 */
export async function documentCheck(
  file: Buffer,
  typedCnic: string | undefined,
  deps: DocumentCheckDeps,
): Promise<DocumentCheckResult> {
  const kind = sniff(file);
  if (!kind) throw new UnsupportedImageError('Only JPEG or PNG photos are accepted');

  const img = await prepare(file).catch(() => {
    throw new UnsupportedImageError('The image could not be decoded');
  });
  const [lines, ela, editor] = await Promise.all([
    deps.ocr(img.ocrPng),
    errorLevel(file),
    editorTag(file),
  ]);
  const blur = blurScore(img.gray);
  const qrText = readQr(img.rgba);
  let parsed = lines ? parseCardText(lines) : null;
  // A real phone photo (card small in the frame, dim, or sideways) often defeats the first pass:
  // look again at a larger, contrast-stretched copy, turning it if needed. Bounded in time.
  const retryUntil = Date.now() + OCR_RETRY_BUDGET_MS;
  for (const turn of OCR_RETRY_TURNS) {
    if (!lines || parsed?.cnic || Date.now() > retryUntil) break;
    const again = await ocrRetryImage(file, turn)
      .then((png) => deps.ocr(png))
      .catch(() => null);
    const next = again ? parseCardText(again) : null;
    if (next?.cnic) parsed = { ...next, name: next.name ?? parsed?.name ?? null };
  }
  const cnicFromOcr = parsed?.cnic ?? null;
  const cnicFromQr = qrText ? findCnic(qrText) : null;

  const checks: Check[] = [];
  const add = (id: CheckId, ok: boolean, detail: string) => checks.push({ id, ok, detail });

  add(
    'cnic_read',
    !!cnicFromOcr,
    cnicFromOcr
      ? `Read ${cnicFromOcr} from the card`
      : lines
        ? 'No CNIC-shaped number found by OCR'
        : 'OCR unavailable',
  );
  // Many cards carry the QR on the back: a missing QR is not a doubt, only nothing to cross-check.
  add(
    'qr_read',
    !qrText || !!cnicFromQr,
    !qrText
      ? 'No QR code visible'
      : cnicFromQr
        ? `QR holds ${cnicFromQr}`
        : 'QR found but holds no CNIC',
  );
  if (cnicFromOcr && cnicFromQr) {
    add(
      'ocr_matches_qr',
      cnicFromOcr === cnicFromQr,
      cnicFromOcr === cnicFromQr
        ? 'Printed number and QR agree'
        : `Printed ${cnicFromOcr}, QR ${cnicFromQr}`,
    );
  }
  // Compared with the printed number (QR if unreadable); a QR conflict is its own check above.
  // Nothing read → cnic_read already raised the doubt; never claim a typing mistake we can't see.
  const onCard = cnicFromOcr ?? cnicFromQr;
  if (typedCnic && onCard) {
    const ok = onCard === typedCnic;
    add(
      'typed_matches_card',
      ok,
      ok ? 'Typed CNIC matches the card' : `Typed ${typedCnic}, card shows ${onCard}`,
    );
  }
  add(
    'compression_consistent',
    ela.regions.length === 0,
    ela.regions.length
      ? `${ela.regions.length} region(s) with a different compression history`
      : 'Uniform compression',
  );
  add(
    'no_editor_software',
    !editor,
    editor ? `Saved by "${editor}"` : 'No editing software recorded',
  );
  add('sharp_enough', blur < BLUR_RETAKE, `Blur score ${blur} (retake at ${BLUR_RETAKE})`);

  const expiry = parsed?.dateOfExpiry ? toDate(parsed.dateOfExpiry) : null;
  if (expiry) {
    const ok = expiry >= (deps.now ?? new Date());
    add('card_not_expired', ok, `${ok ? 'Valid until' : 'Expired on'} ${parsed!.dateOfExpiry}`);
  }
  if (deps.killed) add('ai_available', false, 'Kill AI is on: an officer reviews every document');

  const failed = checks.filter((c) => !c.ok);
  const retakeRequired = blur >= BLUR_RETAKE || (!cnicFromOcr && !cnicFromQr);
  const needsHuman = failed.length > 0;
  return {
    kind,
    cnicFromOcr,
    cnicFromQr,
    fields: parsed && withoutCnic(parsed),
    checks,
    forgeryScore: ela.score,
    blurScore: blur,
    editedRegions: ela.regions,
    needsHuman,
    retakeRequired,
    ...explain(failed, retakeRequired, needsHuman),
  };
}

function explain(failed: Check[], retake: boolean, needsHuman: boolean) {
  if (!needsHuman) {
    return {
      explanationUr: 'کارڈ صاف پڑھا گیا اور سب جانچ درست ہیں۔',
      explanationEn: 'The card was read clearly and every check passed.',
    };
  }
  const ur = failed.map((c) => SAY[c.id].ur);
  const en = failed.map((c) => SAY[c.id].en);
  if (retake) {
    ur.push('براہِ کرم روشنی میں کارڈ کی سیدھی اور صاف تصویر دوبارہ لیں۔');
    en.push('Please take the photo again, straight on and in good light.');
  }
  ur.push('ایک افسر اسے دیکھے گا۔ آپ کی درخواست رد نہیں ہوئی۔');
  en.push('An officer will review it. Your request has not been rejected.');
  return { explanationUr: ur.join(' '), explanationEn: en.join(' ') };
}

const withoutCnic = ({ cnic: _, ...rest }: CardFields) => rest;

function toDate(ddmmyyyy: string): Date | null {
  const [d, m, y] = ddmmyyyy.split('.').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!, 23, 59, 59));
  return Number.isNaN(date.getTime()) || date.getUTCMonth() !== m! - 1 ? null : date;
}
