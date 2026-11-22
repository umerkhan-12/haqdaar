import sharp, { type Sharp } from 'sharp';

export type ImageKind = 'jpeg' | 'png';

/** Decompression-bomb guard: refuse anything over ~40 MP before decoding pixels. */
export const MAX_PIXELS = 40_000_000;
const ANALYSIS_MAX_SIDE = 1600;

export interface Raw {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

/** Trust the bytes, never the extension or the declared MIME type. */
export function sniff(buf: Buffer): ImageKind | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (
    buf.length > 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  return null;
}

export const decoder = (buf: Buffer) =>
  sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: 'error' });

async function raw(img: Sharp): Promise<Raw> {
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

export interface Prepared {
  /** Re-encoded copy: pixels only, no metadata or trailing bytes, at most 1600 px. Safe to store. */
  sanitized: Buffer;
  rgba: Raw;
  /** At most 1000 px, so the blur measure is comparable between photos. */
  gray: Raw;
  /** Lossless grayscale for OCR. */
  ocrPng: Buffer;
}

/** Turns tried, in order, when the first OCR pass finds no card number: a phone photo is often sideways. */
export const OCR_RETRY_TURNS = [0, 90, 270, 180] as const;

/**
 * A second look for OCR at a real phone photo: more pixels than the analysis copy (the card may fill
 * only part of the frame), contrast stretched, and optionally turned.
 */
export async function ocrRetryImage(buf: Buffer, turn: number): Promise<Buffer> {
  const png = await decoder(buf)
    .rotate()
    .resize({ width: 2600, height: 2600, fit: 'inside', withoutEnlargement: true })
    .greyscale()
    .normalise()
    .png()
    .toBuffer();
  return turn ? sharp(png).rotate(turn).png().toBuffer() : png;
}

export async function prepare(buf: Buffer): Promise<Prepared> {
  const sanitized = await decoder(buf)
    .rotate()
    .resize({
      width: ANALYSIS_MAX_SIDE,
      height: ANALYSIS_MAX_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 90 })
    .toBuffer();
  const [rgba, gray, ocrPng] = await Promise.all([
    raw(sharp(sanitized).ensureAlpha()),
    raw(
      sharp(sanitized)
        .resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true })
        .greyscale(),
    ),
    sharp(sanitized).greyscale().png().toBuffer(),
  ]);
  return { sanitized, rgba, gray, ocrPng };
}
