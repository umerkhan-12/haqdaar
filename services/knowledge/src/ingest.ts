import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '../generated/prisma';
import { loadRootEnv } from '@haqdaar/nest-kit';
import { serviceUrl } from '@haqdaar/shared';
import { signInternalToken } from '@haqdaar/nest-kit';
import { OFFLINE_DIMENSIONS, OFFLINE_MODEL, hashedEmbedding } from './retrieval/embeddings';

loadRootEnv();

const POLICY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/policy');
const LIVE_MODEL = process.env.KNOWLEDGE_EMBEDDING_MODEL?.trim() || 'gemini-embedding-001';
const mode = process.env.AI_PROFILE === 'offline' ? 'offline' : 'gemini';
const model = mode === 'offline' ? OFFLINE_MODEL : LIVE_MODEL;
const timeoutMs = Number(process.env.AI_TIMEOUT_MS ?? 20_000);
const prisma = new PrismaClient();

type ChunkInput = { id: string; docId: string; heading: string; content: string; contentHash: string; ordinal: number };

async function main() {
  const files = (await readdir(POLICY_DIR)).filter((file) => file.endsWith('.md')).sort();
  if (!files.length) throw new Error(`No policy markdown files found in ${POLICY_DIR}`);
  const docs = await Promise.all(files.map(async (file) => {
    const markdown = await readFile(join(POLICY_DIR, file), 'utf8');
    const docId = file.replace(/\.md$/i, '');
    const version = markdown.match(/Corpus version:\s*`([^`]+)`/)?.[1] ?? 'unversioned';
    const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? docId;
    const chunks = chunkDocument(docId, markdown);
    return { docId, version, title, contentHash: sha(normalize(markdown)), chunks };
  }));

  const old = await prisma.knowledgeChunk.findMany();
  const previous = new Map(old.map((chunk) => [chunk.id, chunk]));
  let dimension = mode === 'offline' ? OFFLINE_DIMENSIONS : 0;
  const prepared: (ChunkInput & { embedding: number[]; embeddingModel: string; embeddingMode: string; dimension: number })[] = [];

  for (const doc of docs) for (const chunk of doc.chunks) {
    const existing = previous.get(chunk.id);
    let embedding: number[];
    if (existing?.contentHash === chunk.contentHash && existing.embeddingModel === model && existing.embeddingMode === mode) {
      embedding = existing.embedding;
    } else if (mode === 'offline') {
      embedding = hashedEmbedding(chunk.content);
    } else {
      embedding = await requestEmbedding(chunk.content);
    }
    if (!dimension) dimension = embedding.length;
    if (embedding.length !== dimension) throw new Error(`Embedding dimension mismatch in ${chunk.id}`);
    prepared.push({ ...chunk, embedding, embeddingModel: model, embeddingMode: mode, dimension });
  }
  if (!prepared.length || !dimension) throw new Error('Policy corpus produced no text chunks');

  const ids = prepared.map((chunk) => chunk.id);
  const corpusHash = sha(docs.map((doc) => `${doc.docId}:${doc.contentHash}:${doc.version}`).join('\n'));
  await prisma.$transaction(async (tx) => {
    await tx.knowledgeDocument.deleteMany({ where: { docId: { notIn: docs.map((doc) => doc.docId) } } });
    for (const doc of docs) {
      await tx.knowledgeDocument.upsert({
        where: { docId: doc.docId },
        create: { docId: doc.docId, title: doc.title, contentHash: doc.contentHash, version: doc.version },
        update: { title: doc.title, contentHash: doc.contentHash, version: doc.version },
      });
    }
    if (ids.length) await tx.knowledgeChunk.deleteMany({ where: { id: { notIn: ids } } });
    for (const chunk of prepared) {
      const data = {
        docId: chunk.docId, heading: chunk.heading, content: chunk.content, contentHash: chunk.contentHash,
        embedding: chunk.embedding, embeddingModel: chunk.embeddingModel, embeddingMode: chunk.embeddingMode,
        dimension: chunk.dimension, ordinal: chunk.ordinal,
      };
      await tx.knowledgeChunk.upsert({ where: { id: chunk.id }, create: { id: chunk.id, ...data }, update: data });
    }
    await tx.knowledgeIndex.upsert({
      where: { id: 'active' },
      create: { id: 'active', model, mode, dimension, corpusHash },
      update: { model, mode, dimension, corpusHash },
    });
  });
  console.log(`Knowledge index active: ${docs.length} documents, ${prepared.length} chunks, ${mode}/${model}, dimension ${dimension}`);
}

function chunkDocument(docId: string, markdown: string): ChunkInput[] {
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
      start = nextStart;
    }
  }
  return out;
}

/** Rough subword estimate: one token per four Unicode code points, at least one per word. */
function approxTokens(word: string) { return Math.max(1, Math.ceil(Array.from(word).length / 4)); }

async function requestEmbedding(text: string): Promise<number[]> {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret) throw new Error('INTERNAL_SECRET is required to request embeddings through AiRouter');
  const response = await fetch(`${serviceUrl('ai')}/ai/embed`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': signInternalToken('knowledge', 'ai', secret),
    },
    body: JSON.stringify({ text, taskType: 'RETRIEVAL_DOCUMENT' }),
    signal: AbortSignal.timeout(timeoutMs + 2000),
  });
  if (!response.ok) throw new Error(`AI embedding request failed with HTTP ${response.status}`);
  const data = await response.json() as { embedding?: number[]; model?: string };
  if (data.model !== model || !data.embedding?.length || data.embedding.some((value) => !Number.isFinite(value))) {
    throw new Error('AI returned an invalid or incompatible embedding');
  }
  return data.embedding;
}

function normalize(value: string) { return value.normalize('NFKC').replace(/\s+/g, ' ').trim(); }
function sha(value: string) { return createHash('sha256').update(value).digest('hex'); }

main().catch((error) => { console.error('Knowledge ingestion failed:', error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
