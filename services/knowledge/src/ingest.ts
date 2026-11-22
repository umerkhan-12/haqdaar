import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PrismaClient } from '../generated/prisma';
import { loadRootEnv } from '@haqdaar/nest-kit';
import { serviceUrl } from '@haqdaar/shared';
import { signInternalToken } from '@haqdaar/nest-kit';
import { OFFLINE_DIMENSIONS, OFFLINE_MODEL, hashedEmbedding } from './retrieval/embeddings';
import { chunkDocument, normalize, sha, type ChunkInput } from './retrieval/chunk';

loadRootEnv();

const POLICY_DIR = resolve(process.cwd(), '../../docs/policy');
const LIVE_MODEL = process.env.KNOWLEDGE_EMBEDDING_MODEL?.trim() || 'gemini-embedding-001';
const mode = process.env.AI_PROFILE === 'offline' ? 'offline' : 'gemini';
const model = mode === 'offline' ? OFFLINE_MODEL : LIVE_MODEL;
const timeoutMs = Number(process.env.AI_TIMEOUT_MS ?? 20_000);
const prisma = new PrismaClient();

async function main() {
  const files = (await readdir(POLICY_DIR)).filter((file) => file.endsWith('.md')).sort();
  if (!files.length) throw new Error(`No policy markdown files found in ${POLICY_DIR}`);
  const docs = await Promise.all(
    files.map(async (file) => {
      const markdown = await readFile(join(POLICY_DIR, file), 'utf8');
      const docId = file.replace(/\.md$/i, '');
      const version = markdown.match(/Corpus version:\s*`([^`]+)`/)?.[1] ?? 'unversioned';
      const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? docId;
      const chunks = chunkDocument(docId, markdown);
      return { docId, version, title, contentHash: sha(normalize(markdown)), chunks };
    }),
  );

  const old = await prisma.knowledgeChunk.findMany();
  const previous = new Map(old.map((chunk) => [chunk.id, chunk]));
  let dimension = mode === 'offline' ? OFFLINE_DIMENSIONS : 0;
  const prepared: (ChunkInput & {
    embedding: number[];
    embeddingModel: string;
    embeddingMode: string;
    dimension: number;
  })[] = [];

  for (const doc of docs)
    for (const chunk of doc.chunks) {
      const existing = previous.get(chunk.id);
      let embedding: number[];
      if (
        existing?.contentHash === chunk.contentHash &&
        existing.embeddingModel === model &&
        existing.embeddingMode === mode
      ) {
        embedding = existing.embedding;
      } else if (mode === 'offline') {
        embedding = hashedEmbedding(chunk.content);
      } else {
        embedding = await requestEmbedding(chunk.content);
      }
      if (!dimension) dimension = embedding.length;
      if (embedding.length !== dimension)
        throw new Error(`Embedding dimension mismatch in ${chunk.id}`);
      prepared.push({ ...chunk, embedding, embeddingModel: model, embeddingMode: mode, dimension });
    }
  if (!prepared.length || !dimension) throw new Error('Policy corpus produced no text chunks');

  const ids = prepared.map((chunk) => chunk.id);
  const corpusHash = sha(
    docs.map((doc) => `${doc.docId}:${doc.contentHash}:${doc.version}`).join('\n'),
  );
  await prisma.$transaction(
    async (tx) => {
      await tx.knowledgeDocument.deleteMany({
        where: { docId: { notIn: docs.map((doc) => doc.docId) } },
      });
      for (const doc of docs) {
        await tx.knowledgeDocument.upsert({
          where: { docId: doc.docId },
          create: {
            docId: doc.docId,
            title: doc.title,
            contentHash: doc.contentHash,
            version: doc.version,
          },
          update: { title: doc.title, contentHash: doc.contentHash, version: doc.version },
        });
      }
      if (ids.length) await tx.knowledgeChunk.deleteMany({ where: { id: { notIn: ids } } });
      for (const chunk of prepared) {
        const data = {
          docId: chunk.docId,
          heading: chunk.heading,
          content: chunk.content,
          contentHash: chunk.contentHash,
          embedding: chunk.embedding,
          embeddingModel: chunk.embeddingModel,
          embeddingMode: chunk.embeddingMode,
          dimension: chunk.dimension,
          ordinal: chunk.ordinal,
        };
        await tx.knowledgeChunk.upsert({
          where: { id: chunk.id },
          create: { id: chunk.id, ...data },
          update: data,
        });
      }
      await tx.knowledgeIndex.upsert({
        where: { id: 'active' },
        create: { id: 'active', model, mode, dimension, corpusHash },
        update: { model, mode, dimension, corpusHash },
      });
      // The dev database can be behind a slow tunnel: the default 5 s would abort a full re-index.
    },
    { maxWait: 20_000, timeout: 180_000 },
  );
  console.log(
    `Knowledge index active: ${docs.length} documents, ${prepared.length} chunks, ${mode}/${model}, dimension ${dimension}`,
  );
}

async function requestEmbedding(text: string): Promise<number[]> {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret)
    throw new Error('INTERNAL_SECRET is required to request embeddings through AiRouter');
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
  const data = (await response.json()) as { embedding?: number[]; model?: string };
  if (
    data.model !== model ||
    !data.embedding?.length ||
    data.embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new Error('AI returned an invalid or incompatible embedding');
  }
  return data.embedding;
}

main()
  .catch((error) => {
    console.error('Knowledge ingestion failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
