import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jsQR from 'jsqr';
import { createWorker, type Worker } from 'tesseract.js';
import { redactPii } from '../tasks/pii';
import type { Raw } from './image';

/** First CNIC in a text (any separator, Urdu digits too), normalised to 12345-1234567-1. */
export const findCnic = (text: string): string | null => redactPii(text).cnics[0] ?? null;

export function readQr(rgba: Raw): string | null {
  const code = jsQR(
    new Uint8ClampedArray(rgba.data.buffer, rgba.data.byteOffset, rgba.data.length),
    rgba.width,
    rgba.height,
  );
  return code?.data ?? null;
}

export interface CardFields {
  cnic: string | null;
  name: string | null;
  fatherName: string | null;
  gender: 'M' | 'F' | 'X' | null;
  dateOfBirth: string | null;
  dateOfIssue: string | null;
  dateOfExpiry: string | null;
}

// Letters OCR typically confuses with digits, only inside a number-shaped token.
const CONFUSED: Record<string, string> = {
  O: '0',
  o: '0',
  D: '0',
  I: '1',
  l: '1',
  '|': '1',
  S: '5',
  B: '8',
  Z: '2',
};
// OCR also reads the hyphens of a photographed card as dots, commas or underscores.
const NUMBERISH =
  /[\dOoDIl|SBZ]{5}\s?[-–—~.,_]\s?[\dOoDIl|SBZ]{7}\s?[-–—~.,_]\s?[\dOoDIl|SBZ](?![\dA-Za-z])/g;
const DATE = /\b(\d{2})[.\-/](\d{2})[.\-/](\d{4})\b/g;
const PERSON_NAME = /^[A-Za-z][A-Za-z.'-]*(?: [A-Za-z][A-Za-z.'-]*)*/;

/**
 * Read the front-side fields from OCR lines, using the printed labels (Name, Father Name, Gender,
 * Date of Birth, Date of Issue, Date of Expiry) to find the value on the next line.
 */
export function parseCardText(lines: string[]): CardFields {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  const text = clean.join('\n');
  const numberish = (text.match(NUMBERISH) ?? []).map((t) =>
    t.replace(/[OoDIl|SBZ]/g, (c) => CONFUSED[c]!).replace(/\s*[-–—~.,_]\s*/g, '-'),
  );
  const cnic = findCnic(text) ?? numberish.map(findCnic).find(Boolean) ?? null;

  const after = (label: RegExp) => {
    const i = clean.findIndex((l) => label.test(l));
    return i >= 0 ? (clean[i + 1] ?? '') : '';
  };
  const nameOn = (line: string) => line.match(PERSON_NAME)?.[0].trim() || null;
  const datesOn = (line: string) => [...line.matchAll(DATE)].map((m) => `${m[1]}.${m[2]}.${m[3]}`);
  const gender = after(/^gender\b/i).match(/^[MFX]\b/)?.[0] as CardFields['gender'] | undefined;
  const issueRow = datesOn(after(/date of issue/i));

  return {
    cnic,
    name: nameOn(after(/^name\b/i)),
    fatherName: nameOn(after(/^(father|husband)\b/i)),
    gender: gender ?? null,
    dateOfBirth: datesOn(after(/date of birth/i)).at(-1) ?? null,
    dateOfIssue: issueRow.length === 2 ? issueRow[0]! : null,
    dateOfExpiry: issueRow.at(-1) ?? null,
  };
}

/** Words below this confidence (photo texture, QR modules) are dropped before parsing. */
const MIN_WORD_CONFIDENCE = 55;

/**
 * One cached Tesseract worker (English model, downloaded once to TESSDATA_DIR). It runs in a
 * worker thread, so OCR never blocks the event loop; jobs queue on the worker.
 */
export class OcrEngine {
  private worker?: Promise<Worker>;

  constructor(private readonly cachePath = join(tmpdir(), 'haqdaar-tessdata')) {}

  /** Start loading the model in the background (first start downloads ~10 MB). */
  warm(): Promise<unknown> {
    return this.get().catch(() => undefined);
  }

  async readLines(png: Buffer, timeoutMs: number): Promise<string[] | null> {
    const worker = await withTimeout(this.get(), timeoutMs);
    if (!worker) return null;
    const result = await withTimeout(worker.recognize(png, {}, { blocks: true }), timeoutMs);
    if (!result) return null;
    return (result.data.blocks ?? []).flatMap((b) =>
      b.paragraphs.flatMap((p) =>
        p.lines.map((l) =>
          l.words
            .filter((w) => w.confidence >= MIN_WORD_CONFIDENCE)
            .map((w) => w.text)
            .join(' '),
        ),
      ),
    );
  }

  async terminate(): Promise<void> {
    const w = this.worker;
    this.worker = undefined;
    await w?.then((x) => x.terminate()).catch(() => undefined);
  }

  private get(): Promise<Worker> {
    this.worker ??= createWorker('eng', 1, { cachePath: this.cachePath }).catch((err: unknown) => {
      this.worker = undefined; // retry on the next call (e.g. model download failed offline)
      throw err;
    });
    return this.worker;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms))),
  ]).finally(() => clearTimeout(timer));
}
