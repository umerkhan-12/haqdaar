import {
  contentTokens,
  idfTable,
  isOutOfScope,
  isRomanUrdu,
  queryTokens,
  rankLexical,
  type LexicalChunk,
} from './lexical';

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

/** At most this many chunks reach the answer, so it stays on one topic and can be read aloud. */
const MAX_CHUNKS = 2;
const MAX_SENTENCES = 3;

/**
 * Local ranking (offline profile, Kill AI, no embedding credit): BM25 over stemmed words and the
 * Urdu / Roman-Urdu concept table. Nothing is returned (the caller refuses) when fewer than
 * `minCoverage` of the question's words are in the best chunk, or when the question is an order,
 * an injection or a request for somebody's personal details.
 */
export function rankLocal<T extends LexicalChunk>(
  question: string,
  chunks: T[],
  minCoverage: number,
): Ranked<T>[] {
  if (isOutOfScope(question)) return [];
  const hits = rankLexical(question, chunks);
  const best = hits[0];
  if (!best || best.coverage < minCoverage) return [];
  return hits
    .filter((hit) => hit.score >= best.score * 0.75)
    .slice(0, MAX_CHUNKS)
    .map(({ chunk, score }) => ({ chunk, score }));
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

type Pair = { source: Source; at: number; quote: string; tokens: Set<string> };

/** Each English sentence with its Urdu twin, so a question in either language finds the same sentence. */
function sentencePairs(source: Source): Pair[] {
  const all = sentenceCandidates(source.content);
  const en = all.filter((s) => languageOf(s) === 'en');
  const ur = all.filter((s) => languageOf(s) === 'ur');
  const paired = en.length === ur.length;
  return (paired ? en : all).map((quote, at) => ({
    source,
    at,
    quote,
    tokens: new Set(contentTokens(paired ? `${quote} ${ur[at]}` : quote)),
  }));
}

/**
 * No model: the answer is the sentences that share the most (and the rarest) words with the question,
 * then the sentences that follow the best one, 3 at most, word for word, from at most two chunks,
 * in reading order.
 */
export function extractiveAnswer(question: string, sources: Source[]): Answer {
  const query = queryTokens(question);
  const used = sources.slice(0, MAX_CHUNKS);
  const pairs = used.flatMap(sentencePairs);
  if (!query.length || !pairs.length) return refusal();
  const idf = idfTable(pairs.map((pair) => [...pair.tokens]));
  const scored = pairs
    .map((pair) => ({
      pair,
      score: query.reduce((sum, token) => sum + (pair.tokens.has(token) ? idf(token) + 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0]!.score;
  if (best <= 0) return refusal();
  const chosen = scored
    .filter((item) => item.score >= best * 0.75)
    .slice(0, MAX_SENTENCES)
    .map((item) => item.pair);
  // A lone opening sentence ("eligible when all four rules are true") needs the lines after it.
  const lead = chosen[0]!;
  for (const pair of pairs) {
    if (chosen.length >= MAX_SENTENCES) break;
    if (pair.source === lead.source && pair.at > lead.at && !chosen.includes(pair))
      chosen.push(pair);
  }
  const citations = chosen
    .sort((a, b) => used.indexOf(a.source) - used.indexOf(b.source) || a.at - b.at)
    .map(({ source, quote }) => ({ docId: source.docId, heading: source.heading, quote }));
  return {
    answer: citations.map((citation) => citation.quote).join(' '),
    citations,
    refused: false,
  };
}

/** The sentences of a chunk that may be quoted alone (exported so the corpus format is tested). */
export function sentenceCandidates(content: string) {
  return content
    .split(/(?<=[.!؟۔])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20 && sentence.length <= 700);
}

export type AnswerLang = 'ur' | 'en';

/** A sentence counts as Urdu when it has Arabic-script letters; the policy files are English + Urdu. */
export function languageOf(text: string): AnswerLang {
  return /[؀-ۿ]/.test(text) ? 'ur' : 'en';
}

/** Language to answer a question in: Roman Urdu ("paise kab milenge") is answered in Urdu. */
export function questionLanguage(question: string): AnswerLang {
  return languageOf(question) === 'ur' || isRomanUrdu(question) ? 'ur' : 'en';
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
