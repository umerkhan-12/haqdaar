import { createHash } from 'node:crypto';

export const OFFLINE_MODEL = 'hashed-bow-v1';
export const OFFLINE_DIMENSIONS = 384;

/** Stable signed hashed bag-of-words vector for offline retrieval (not a semantic model). */
export function hashedEmbedding(text: string, dimensions = OFFLINE_DIMENSIONS): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  for (const token of terms(text)) {
    const digest = createHash('sha256').update(token).digest();
    const index = digest.readUInt32BE(0) % dimensions;
    vector[index] += digest[4]! & 1 ? 1 : -1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm ? vector.map((value) => value / norm) : vector;
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (!normA || !normB) return 0;
  return dot / Math.sqrt(normA * normB);
}

export function terms(input: string): string[] {
  return (
    input
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[٠-٩۰-۹]/g, (d) => String('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'.indexOf(d) % 10))
      .match(/[\p{L}\p{N}]{2,}/gu) ?? []
  );
}
