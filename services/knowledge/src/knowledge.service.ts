import { Injectable, Logger } from '@nestjs/common';
import { ServiceClient } from '@haqdaar/nest-kit';
import { PrismaService } from './prisma.service';
import { cosine } from './retrieval/embeddings';
import {
  extractiveAnswer,
  localize,
  questionLanguage,
  rankLocal,
  redactPii,
  refusal,
  validCitations,
  type Answer,
  type AnswerLang,
  type Source,
} from './retrieval/answer';
import { isOutOfScope } from './retrieval/lexical';
import { env } from './env';

const LIVE_THRESHOLD = env.KNOWLEDGE_RELEVANCE_THRESHOLD;
const LOCAL_COVERAGE = env.KNOWLEDGE_LOCAL_COVERAGE;

type AiStatus = { profile: 'dev' | 'demo' | 'offline'; killed: boolean };
type Chunk = {
  id: string;
  docId: string;
  heading: string;
  content: string;
  embedding: number[];
  dimension: number;
};

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly upstream: ServiceClient,
  ) {}

  /** Answers only from the policy files, in the language asked for (default: the language of the question). */
  async ask(question: string, lang: AnswerLang = questionLanguage(question)) {
    const sources: Source[] = [];
    return localize(await this.answer(question, sources), sources, lang);
  }

  private async answer(question: string, used: Source[]): Promise<Answer> {
    const redactedQuestion = redactPii(question);
    // Orders, injected instructions and requests for somebody's details never reach a model.
    if (isOutOfScope(redactedQuestion)) return this.refused();
    const index = await this.prisma.knowledgeIndex.findUnique({ where: { id: 'active' } });
    if (!index) return this.refused();

    // No AI service, Kill AI, the offline profile, or embeddings that cannot be had (no key, quota,
    // an index built in another mode): all of these answer locally, with no model call.
    let status: AiStatus | null = null;
    try {
      status = await this.upstream.call<AiStatus>('ai', '/ai/status', { timeoutMs: 2500 });
    } catch (error) {
      this.logger.warn(
        { error: String(error) },
        'AI status unavailable, answering from local retrieval',
      );
    }
    const chunks = (await this.prisma.knowledgeChunk.findMany({
      orderBy: [{ docId: 'asc' }, { ordinal: 'asc' }],
    })) as Chunk[];
    if (!chunks.length) return this.refused();

    let offline = !status || status.killed || status.profile === 'offline';
    let ranked: { chunk: Chunk; score: number }[] = [];
    if (!offline) {
      const live =
        index.mode === 'gemini'
          ? await this.rankByLiveEmbedding(redactedQuestion, index, chunks)
          : null;
      if (live) ranked = live;
      else offline = true;
    }
    if (offline) {
      // No usable embedding: BM25 over stemmed words and the Urdu / Roman-Urdu concept table.
      // The stored hashed vectors are not used to rank; they only keep the index shape valid.
      ranked = rankLocal(redactedQuestion, chunks, LOCAL_COVERAGE);
    }
    if (!ranked.length) return this.refused();

    const sources: Source[] = ranked.map(({ chunk }) => ({
      id: chunk.id,
      docId: chunk.docId,
      heading: chunk.heading,
      content: chunk.content,
    }));
    used.push(...sources);
    if (offline) return extractiveAnswer(redactedQuestion, sources);
    try {
      const answer = await this.upstream.call<{
        answer: string;
        citations: { docId: string; heading: string; quote: string }[];
        refused: boolean;
      }>('ai', '/ai/answer-from-sources', {
        method: 'POST',
        body: { question: redactedQuestion, sources },
        timeoutMs: 18_000,
      });
      if (answer.refused || !validCitations(answer, sources)) return this.refused();
      return answer;
    } catch (error) {
      this.logger.warn(
        { error: String(error) },
        'Could not produce a source-grounded policy answer',
      );
      return this.refused();
    }
  }

  /** Null when live embeddings are unavailable or do not match the index; the caller then answers locally. */
  private async rankByLiveEmbedding(
    question: string,
    index: { model: string; dimension: number },
    chunks: Chunk[],
  ) {
    try {
      const embedded = await this.upstream.call<{ embedding: number[]; model: string }>(
        'ai',
        '/ai/embed',
        {
          method: 'POST',
          body: { text: question, taskType: 'RETRIEVAL_QUERY' },
          timeoutMs: 22_000,
        },
      );
      if (embedded.model !== index.model || embedded.embedding.length !== index.dimension)
        return null;
      return chunks
        .filter((chunk) => chunk.dimension === index.dimension)
        .map((chunk) => ({ chunk, score: cosine(embedded.embedding, chunk.embedding) }))
        .sort((a, b) => b.score - a.score)
        .filter((item) => item.score >= LIVE_THRESHOLD)
        .slice(0, 4);
    } catch (error) {
      this.logger.warn(
        { error: String(error) },
        'Live policy embeddings unavailable, answering from local retrieval',
      );
      return null;
    }
  }

  private refused() {
    return refusal();
  }
}
