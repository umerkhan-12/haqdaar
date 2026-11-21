import exifr from 'exifr';
import sharp from 'sharp';
import { decoder, type Raw } from './image';

/** Box as fractions (0..1) of the uploaded image, so the UI can draw it at any size. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElaResult {
  /** 0 = consistent compression everywhere, ≥ 0.5 = at least one edited-looking region. */
  score: number;
  regions: Region[];
}

const ELA_QUALITY = 75;
const BLOCK = 16;
const TEXT_GRADIENT = 8; // only blocks with real edges (text, lines) carry an ELA signal
const MIN_RATIO = 0.06;
const OUTLIER_FACTOR = 1.4;
/** About one short printed field (e.g. the identity number); isolated hot blocks are noise. */
const MIN_REGION_BLOCKS = 6;

/**
 * Error-level analysis. Re-save the original at a known JPEG quality and measure, per 16 px
 * block, how much the brightness changes relative to how much edge detail the block has.
 * Areas with the same compression history change alike; content pasted in from elsewhere
 * (a different number, a new photo) has a different history and changes more. Hot blocks are
 * grouped along text lines and only groups of MIN_REGION_BLOCKS or more count as regions.
 * The threshold is relative to the image's own 90th percentile, so a card saved once is fine.
 */
export async function errorLevel(original: Buffer): Promise<ElaResult> {
  const { data: a, info } = await decoder(original)
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const resaved = await sharp(a, { raw: info }).jpeg({ quality: ELA_QUALITY }).toBuffer();
  const b = await sharp(resaved).greyscale().raw().toBuffer();

  const bw = Math.floor(w / BLOCK);
  const bh = Math.floor(h / BLOCK);
  const err = new Float64Array(bw * bh);
  const grad = new Float64Array(bw * bh);
  for (let y = 0; y < bh * BLOCK; y++) {
    for (let x = 0; x < bw * BLOCK; x++) {
      const p = y * w + x;
      const k = Math.floor(y / BLOCK) * bw + Math.floor(x / BLOCK);
      err[k] += Math.abs(a[p]! - b[p]!);
      if (x + 1 < w && y + 1 < h)
        grad[k] += Math.abs(a[p]! - a[p + 1]!) + Math.abs(a[p]! - a[p + w]!);
    }
  }

  const ratio = new Float64Array(bw * bh).fill(-1);
  const ratios: number[] = [];
  for (let k = 0; k < ratio.length; k++) {
    if (grad[k]! / (BLOCK * BLOCK) <= TEXT_GRADIENT) continue;
    ratio[k] = err[k]! / grad[k]!;
    ratios.push(ratio[k]!);
  }
  if (ratios.length < 20) return { score: 0, regions: [] };
  ratios.sort((x, y) => x - y);
  const threshold = Math.max(MIN_RATIO, OUTLIER_FACTOR * ratios[Math.floor(ratios.length * 0.9)]!);

  const regions: Region[] = [];
  let largest = 0;
  const seen = new Uint8Array(ratio.length);
  for (let k = 0; k < ratio.length; k++) {
    if (seen[k] || ratio[k]! < threshold) continue;
    const stack = [k];
    const blocks: number[] = [];
    seen[k] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      blocks.push(c);
      const cx = c % bw;
      const cy = Math.floor(c / bw);
      // Wider horizontally: gaps between characters must not split a printed line.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          const n = ny * bw + nx;
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh || seen[n] || ratio[n]! < threshold)
            continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    largest = Math.max(largest, blocks.length);
    if (blocks.length < MIN_REGION_BLOCKS) continue;
    const xs = blocks.map((c) => c % bw);
    const ys = blocks.map((c) => Math.floor(c / bw));
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    regions.push({
      x: round((x0 * BLOCK) / w),
      y: round((y0 * BLOCK) / h),
      width: round(((Math.max(...xs) - x0 + 1) * BLOCK) / w),
      height: round(((Math.max(...ys) - y0 + 1) * BLOCK) / h),
    });
  }

  // 0.5 exactly at the smallest region that counts, 1 at twice that size.
  return { score: round(Math.min(1, largest / (2 * MIN_REGION_BLOCKS))), regions };
}

/** Laplacian variance at which blurScore = 1/e (≈ 0.37). */
const SHARP_VARIANCE = 150;
export const BLUR_RETAKE = 0.5;

/** Laplacian variance of a ≤ 1000 px grayscale copy, mapped so 0 = sharp, 1 = very blurry. */
export function blurScore(gray: Raw): number {
  const { data, width: w, height: h } = gray;
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const v = data[p - w]! + data[p + w]! + data[p - 1]! + data[p + 1]! - 4 * data[p]!;
      sum += v;
      sq += v * v;
      n++;
    }
  }
  const variance = n ? sq / n - (sum / n) ** 2 : 0;
  return round(Math.exp(-variance / SHARP_VARIANCE));
}

const EDITORS =
  /photoshop|gimp|lightroom|snapseed|picsart|canva|pixlr|affinity|paint\.net|facetune|remini|photopea|fotor|inshot|meitu|polarr|vsco|airbrush|photo\s*editor/i;

/** Editing software recorded in EXIF/XMP. Absent metadata is normal (messengers strip it). */
export async function editorTag(original: Buffer): Promise<string | null> {
  const tags = (await exifr
    .parse(original, { tiff: true, xmp: true, exif: false, gps: false, interop: false })
    .catch(() => null)) as Record<string, unknown> | null;
  if (!tags) return null;
  for (const key of ['Software', 'ProcessingSoftware', 'CreatorTool', 'HistorySoftwareAgent']) {
    const v = tags[key];
    const s = Array.isArray(v) ? v.join(' ') : typeof v === 'string' ? v : '';
    if (EDITORS.test(s)) return s.trim().slice(0, 80);
  }
  return null;
}

const round = (v: number) => Math.round(v * 1000) / 1000;
