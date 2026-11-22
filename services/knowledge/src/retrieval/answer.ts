import { cosine, hashedEmbedding, terms } from './embeddings';

/** Pure retrieval and answer helpers: no database, no network, no environment. */

export const REFUSAL =
  'I can answer questions covered by the program policy documents. I could not find a supported answer. میں صرف پروگرام کی پالیسی دستاویزات کے مطابق جواب دے سکتا ہوں، لیکن متعلقہ جواب نہیں ملا۔';

export type Source = { id: string; docId: string; heading: string; content: string };
export type Citation = { docId: string; heading: string; quote: string };
export type Answer = { answer: string; citations: Citation[]; refused: boolean };
type Ranked<T> = { chunk: T; score: number };

export function refusal(): Answer {
  return { answer: REFUSAL, citations: [], refused: true };
}

/** Offline index: the question is hashed the same way the chunks were at ingestion. */
export function rankByHashedEmbedding<T extends { embedding: number[] }>(
  question: string,
  chunks: T[],
  dimension: number,
  threshold: number,
): Ranked<T>[] {
  const query = hashedEmbedding(question, dimension);
  return top(
    chunks.map((chunk) => ({ chunk, score: cosine(query, chunk.embedding) })),
    threshold,
  );
}

/** Kill AI against a live index: plain word overlap, no model call. */
export function rankByWords<T extends { content: string }>(
  question: string,
  chunks: T[],
  threshold: number,
): Ranked<T>[] {
  return top(
    chunks.map((chunk) => ({ chunk, score: lexicalScore(question, chunk.content) })),
    threshold,
  );
}

function top<T>(ranked: Ranked<T>[], threshold: number): Ranked<T>[] {
  return ranked
    .sort((a, b) => b.score - a.score)
    .filter((item) => item.score >= threshold)
    .slice(0, 4);
}

/** The model's answer is accepted only if it is exactly its quotes, and every quote is in a retrieved source. */
export function validCitations(
  answer: { answer: string; citations: Citation[] },
  sources: { docId: string; heading: string; content: string }[],
) {
  if (!answer.answer.trim() || !answer.citations.length) return false;
  return (
    answer.answer === answer.citations.map((citation) => citation.quote).join(' ') &&
    answer.citations.every(
      (citation) =>
        sources.some(
          (source) =>
            source.docId === citation.docId &&
            source.heading === citation.heading &&
            source.content.includes(citation.quote),
        ) && answer.answer.includes(citation.quote),
    )
  );
}

export function redactPii(input: string) {
  return input
    .replace(/[٠-٩۰-۹]/g, (d) => String('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'.indexOf(d) % 10))
    .replace(/\b\d{5}[-\s]?\d{7}[-\s]?\d\b/g, '[CNIC]')
    .replace(/(?:\+?92[-\s]?|0)3\d{2}[-\s]?\d{7}\b/g, '[PHONE]');
}

export function lexicalScore(question: string, content: string) {
  const query = new Set(terms(question).filter((term) => !STOP.has(term)));
  if (!query.size) return 0;
  const body = new Set(terms(content));
  const overlaps = [...query].filter((term) => body.has(term)).length;
  return overlaps / query.size;
}

const STOP = new Set([
  'what',
  'when',
  'where',
  'who',
  'how',
  'the',
  'for',
  'and',
  'are',
  'is',
  'can',
  'will',
  'میں',
  'کیا',
  'کے',
  'کی',
  'ہے',
  'ہیں',
]);

/** No model: the answer is the best-matching sentences of the retrieved chunks, word for word. */
export function extractiveAnswer(question: string, sources: Source[], threshold: number): Answer {
  const query = new Set(terms(question).filter((term) => !STOP.has(term)));
  const selections = sources
    .flatMap((source) =>
      sentenceCandidates(source.content).map((quote) => ({
        source,
        quote,
        score: lexicalScore(question, quote),
      })),
    )
    .filter((item) => item.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  if (!selections.length || !query.size) return refusal();
  const citations = selections.map(({ source, quote }) => ({
    docId: source.docId,
    heading: source.heading,
    quote,
  }));
  return {
    answer: citations.map((citation) => citation.quote).join(' '),
    citations,
    refused: false,
  };
}

function sentenceCandidates(content: string) {
  return content
    .split(/(?<=[.!؟۔])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20 && sentence.length <= 700);
}

export type AnswerLang = 'ur' | 'en';

/** A sentence counts as Urdu when it has Arabic-script letters; the policy files are English + Urdu. */
export function languageOf(text: string): AnswerLang {
  return /[\u0600-\u06FF]/.test(text) ? 'ur' : 'en';
}

/**
 * Answer in the language she asked in. Every policy paragraph says the same thing in English and then
 * in Urdu, sentence for sentence, so a quote in the other language is swapped for its counterpart at the
 * same position. Still word for word from the source; a sentence with no counterpart is kept as it is.
 */
export function localize(answer: Answer, sources: Source[], lang: AnswerLang): Answer {
  if (answer.refused) return answer;
  const citations: Citation[] = [];
  for (const citation of answer.citations) {
    const source = sources.find(
      (s) =>
        s.docId === citation.docId &&
        s.heading === citation.heading &&
        s.content.includes(citation.quote),
    );
    const quotes = source
      ? sentenceCandidates(citation.quote).map((q) => counterpart(q, source.content, lang))
      : [];
    for (const quote of quotes.length ? quotes : [citation.quote]) {
      if (!citations.some((c) => c.quote === quote))
        citations.push({ docId: citation.docId, heading: citation.heading, quote });
    }
  }
  return { answer: citations.map((c) => c.quote).join(' '), citations, refused: false };
}

function counterpart(sentence: string, content: string, lang: AnswerLang): string {
  if (languageOf(sentence) === lang) return sentence;
  const all = sentenceCandidates(content);
  const same = all.filter((s) => languageOf(s) !== lang);
  const other = all.filter((s) => languageOf(s) === lang);
  const at = same.indexOf(sentence);
  return at >= 0 && same.length === other.length ? other[at]! : sentence;
}
