import { createHash } from 'node:crypto';

export type ChunkInput = { id: string; docId: string; heading: string; content: string; contentHash: string; ordinal: number };

/** Split a policy document by `##` heading, about 400 estimated tokens per chunk with 50 of overlap. */
export function chunkDocument(docId: string, markdown: string): ChunkInput[] {
  const lines = markdown.split(/\r?\n/);
  const sections: { heading: string; lines: string[] }[] = [];
  let current: { heading: string; lines: string[] } = { heading: docId, lines: [] };
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      if (current.lines.join(' ').trim()) sections.push(current);
      current = { heading: heading[1]!, lines: [] };
    } else if (!line.startsWith('# ') && !line.startsWith('Corpus version:')) {
      current.lines.push(line);
    }
  }
  if (current.lines.join(' ').trim()) sections.push(current);

  const out: ChunkInput[] = [];
  for (const section of sections) {
    const words = section.lines.join(' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const size = 400;
    const overlap = 50;
    let start = 0;
    while (start < words.length) {
      let end = start;
      let tokenCount = 0;
      while (end < words.length && (tokenCount + approxTokens(words[end]!) <= size || end === start)) {
        tokenCount += approxTokens(words[end]!);
        end++;
      }
      const content = words.slice(start, end).join(' ').trim();
      if (!content) continue;
      const ordinal = out.length;
      out.push({
        id: `${docId}-${sha(`${section.heading}:${ordinal}`).slice(0, 20)}`,
        docId,
        heading: section.heading,
        content,
        contentHash: sha(normalize(content)),
        ordinal,
      });
      if (end >= words.length) break;
      let nextStart = end;
      let overlapCount = 0;
      while (nextStart > start && overlapCount < overlap) {
        nextStart--;
        overlapCount += approxTokens(words[nextStart]!);
      }
      start = Math.max(nextStart, start + 1); // always move forward, even past one huge word
    }
  }
  return out;
}

/** Rough subword estimate: one token per four Unicode code points, at least one per word. */
function approxTokens(word: string) { return Math.max(1, Math.ceil(Array.from(word).length / 4)); }

export function normalize(value: string) { return value.normalize('NFKC').replace(/\s+/g, ' ').trim(); }
export function sha(value: string) { return createHash('sha256').update(value).digest('hex'); }
