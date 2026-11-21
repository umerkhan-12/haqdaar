import { Injectable, Logger } from '@nestjs/common';
import { ServiceClient } from '@haqdaar/nest-kit';
import { PrismaService } from './prisma.service';
import { cosine, hashedEmbedding, terms } from './retrieval/embeddings';
import { env } from './env';

const REFUSAL = 'I can answer questions covered by the program policy documents. I could not find a supported answer. میں صرف پروگرام کی پالیسی دستاویزات کے مطابق جواب دے سکتا ہوں، لیکن متعلقہ جواب نہیں ملا۔';
const LIVE_THRESHOLD = env.KNOWLEDGE_RELEVANCE_THRESHOLD;
const OFFLINE_THRESHOLD = env.KNOWLEDGE_OFFLINE_THRESHOLD;

type AiStatus = { profile: 'dev' | 'demo' | 'offline'; killed: boolean };
type Chunk = { id: string; docId: string; heading: string; content: string; embedding: number[]; dimension: number };

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  constructor(private readonly prisma: PrismaService, private readonly upstream: ServiceClient) {}

  async ask(question: string) {
    const redactedQuestion = redactPii(question);
    const index = await this.prisma.knowledgeIndex.findUnique({ where: { id: 'active' } });
    if (!index) return this.refused();

    let status: AiStatus;
    try {
      status = await this.upstream.call<AiStatus>('ai', '/ai/status', { timeoutMs: 2500 });
    } catch {
      return this.refused();
    }
    const offline = status.killed || status.profile === 'offline';
    const chunks = await this.prisma.knowledgeChunk.findMany({ orderBy: [{ docId: 'asc' }, { ordinal: 'asc' }] }) as Chunk[];
    if (!chunks.length) return this.refused();

    let ranked: { chunk: Chunk; score: number }[];
    if (offline) {
      // Offline index uses the same deterministic hash vectors created by ingestion. If Kill AI
      // is enabled against a live index, use local lexical matching and make no model call.
      ranked = status.profile === 'offline' && index.mode === 'offline'
        ? chunks.map((chunk) => ({ chunk, score: cosine(hashedEmbedding(redactedQuestion, index.dimension), chunk.embedding) }))
        : chunks.map((chunk) => ({ chunk, score: lexicalScore(redactedQuestion, chunk.content) }));
      ranked.sort((a, b) => b.score - a.score);
      ranked = ranked.filter((item) => item.score >= OFFLINE_THRESHOLD).slice(0, 4);
    } else {
      if (index.mode !== 'gemini') return this.refused();
      try {
        const embedded = await this.upstream.call<{ embedding: number[]; model: string }>('ai', '/ai/embed', {
          method: 'POST', body: { text: redactedQuestion, taskType: 'RETRIEVAL_QUERY' }, timeoutMs: 22_000,
        });
        if (embedded.model !== index.model || embedded.embedding.length !== index.dimension) return this.refused();
        ranked = chunks
          .filter((chunk) => chunk.dimension === index.dimension)
          .map((chunk) => ({ chunk, score: cosine(embedded.embedding, chunk.embedding) }))
          .sort((a, b) => b.score - a.score)
          .filter((item) => item.score >= LIVE_THRESHOLD)
          .slice(0, 4);
      } catch (error) {
        this.logger.warn({ error: String(error) }, 'Could not retrieve policy embeddings');
        return this.refused();
      }
    }
    if (!ranked.length) return this.refused();

    const sources = ranked.map(({ chunk }) => ({ id: chunk.id, docId: chunk.docId, heading: chunk.heading, content: chunk.content }));
    if (offline) return extractiveAnswer(redactedQuestion, sources);
    try {
      const answer = await this.upstream.call<{ answer: string; citations: { docId: string; heading: string; quote: string }[]; refused: boolean }>(
        'ai', '/ai/answer-from-sources', { method: 'POST', body: { question: redactedQuestion, sources }, timeoutMs: 18_000 },
      );
      if (answer.refused || !validCitations(answer, sources)) return this.refused();
      return answer;
    } catch (error) {
      this.logger.warn({ error: String(error) }, 'Could not produce a source-grounded policy answer');
      return this.refused();
    }
  }

  private refused() { return { answer: REFUSAL, citations: [], refused: true }; }
}

function validCitations(
  answer: { answer: string; citations: { docId: string; heading: string; quote: string }[] },
  sources: { docId: string; heading: string; content: string }[],
) {
  if (!answer.answer.trim() || !answer.citations.length) return false;
  return answer.answer === answer.citations.map((citation) => citation.quote).join(' ') &&
    answer.citations.every((citation) =>
    sources.some((source) => source.docId === citation.docId && source.heading === citation.heading && source.content.includes(citation.quote)) &&
    answer.answer.includes(citation.quote),
  );
}

function redactPii(input: string) {
  return input
    .replace(/[٠-٩۰-۹]/g, (d) => String('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'.indexOf(d) % 10))
    .replace(/\b\d{5}[-\s]?\d{7}[-\s]?\d\b/g, '[CNIC]')
    .replace(/(?:\+?92[-\s]?|0)3\d{2}[-\s]?\d{7}\b/g, '[PHONE]');
}

function lexicalScore(question: string, content: string) {
  const query = new Set(terms(question).filter((term) => !STOP.has(term)));
  if (!query.size) return 0;
  const body = new Set(terms(content));
  const overlaps = [...query].filter((term) => body.has(term)).length;
  return overlaps / query.size;
}

const STOP = new Set(['what', 'when', 'where', 'who', 'how', 'the', 'for', 'and', 'are', 'is', 'can', 'will', 'میں', 'کیا', 'کے', 'کی', 'ہے', 'ہیں']);

function extractiveAnswer(question: string, sources: { id: string; docId: string; heading: string; content: string }[]) {
  const query = new Set(terms(question).filter((term) => !STOP.has(term)));
  const selections = sources
    .flatMap((source) => sentenceCandidates(source.content).map((quote) => ({ source, quote, score: lexicalScore(question, quote) })))
    .filter((item) => item.score >= OFFLINE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  if (!selections.length || !query.size) return { answer: REFUSAL, citations: [], refused: true };
  const citations = selections.map(({ source, quote }) => ({ docId: source.docId, heading: source.heading, quote }));
  return { answer: citations.map((citation) => citation.quote).join(' '), citations, refused: false };
}

function sentenceCandidates(content: string) {
  return content.split(/(?<=[.!؟۔])\s+/u).map((sentence) => sentence.trim()).filter((sentence) => sentence.length >= 20 && sentence.length <= 700);
}
