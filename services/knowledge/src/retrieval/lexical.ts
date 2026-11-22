import { terms } from './embeddings';

/**
 * Local retrieval that needs no embedding model: light English stemming, a small Urdu / Roman-Urdu
 * concept table for the words citizens really use, and BM25 over the policy chunks. It exists because
 * the hashed bag of words could not match "eligible" with "eligibility" or "paise" with "payment".
 */

/** Words that mean the same thing for a citizen, in English, then Roman Urdu, then Urdu script. */
const CONCEPTS: Record<string, [english: string, roman: string, urdu: string]> = {
  money: ['money amount cash much', 'paisa paise paisay pese raqam rakam', 'رقم پیسے پیسہ پیسوں'],
  pay: [
    'pay paid pays paying payment payments payout',
    'adaigi milenge milega milegi milti milta aayenge ayenge aayega ayega aaye',
    'ادائیگی ادائیگیاں ملتی ملتا ملے ملیں ملی آئیں آئے',
  ],
  when: ['date schedule', 'kab tareekh tarikh', 'کب تاریخ'],
  wait: ['long wait waiting waited delay delayed time', 'der dair intezar waqt', 'دیر انتظار وقت'],
  eligibl: [
    'eligible eligibility eligibl qualify qualifies entitled',
    'haqdaar haqdar ahl mustahiq ahliyat',
    'حقدار اہل مستحق اہلیت',
  ],
  complain: ['complain complaint complaints', 'shikayat shikayt shikait', 'شکایت'],
  scam: [
    'scam scams fraud fake cheat',
    'dhoka dhoke dhokha jaali jali naqli fareb',
    'دھوکا دھوکہ دھوکے جعلی فراڈ نقلی',
  ],
  consent: ['consent permission permissions', 'ijazat ijaazat razamandi', 'اجازت رضامندی'],
  cnic: ['cnic card nic', 'shanakhti shanakht', 'شناختی کارڈ'],
  claim: ['claim claims apply application', 'darkhwast darkhast darkhuast', 'درخواست درخواستیں'],
  helper: ['helper helpers agent', 'madadgar', 'مددگار ایجنٹ'],
  officer: ['officer officers staff', 'afsar', 'افسر عملہ'],
  fee: ['fee fees charges deposit', 'fis', 'فیس چارجز'],
  message: ['message messages sms text', 'paigham pegham', 'پیغام'],
  real: ['real genuine', 'asli', 'اصلی'],
  seal: ['seal', 'mohar mohr', 'مہر'],
  pin: ['pin otp password', 'khufia', 'پن پاس خفیہ'],
  widow: ['widow widows widowed', 'bewa bewah', 'بیوہ'],
  income: ['income salary earn earnings', 'aamdan amdani aamdani tankhwah', 'آمدن آمدنی'],
  district: ['district districts area', 'zila zilla', 'ضلع ضلعے'],
  household: [
    'household home family families members',
    'ghar gharana khandan',
    'گھر گھرانہ گھرانے خاندان',
  ],
  document: [
    'document documents paper papers',
    'kaghaz kaghzat dastawez',
    'کاغذ دستاویز دستاویزات',
  ],
  photo: ['photo photos picture', 'tasveer tasvir', 'تصویر'],
  withdraw: ['withdraw withdrawal withdrawn back', 'wapas wapis', 'واپس'],
  correct: [
    'correct corrects correction wrong mistake',
    'durust darusti ghalat galat',
    'درست درستگی غلط',
  ],
  check: ['check checks checking checked review', 'jaanch janch', 'جانچ جانچتا جانچیں'],
  internet: ['internet offline', 'net', 'انٹرنیٹ'],
  voice: ['voice speak microphone', 'awaz aawaz bol', 'آواز مائیک'],
  free: ['free', 'muft', 'مفت'],
  month: ['month monthly', 'mahana mahina mahine', 'ماہانہ مہینے مہینہ'],
  approv: ['approve approves approved approval', 'manzoor manzur', 'منظور منظوری'],
  reject: ['reject rejects rejected refuse refused', 'mustarad inkar', 'مسترد انکار'],
  data: ['data details information', 'maloomat malumat', 'معلومات'],
  share: ['share part keep keeps', 'hissa', 'حصہ'],
  link: ['link links', 'link', 'لنک'],
  number: ['number numbers', 'nambar', 'نمبر'],
  see: [
    'see sees seen view access',
    'dekh dekhta dekhte dekhna',
    'دیکھ دیکھتا دیکھتے دیکھے دیکھیں',
  ],
};

const STOP = new Set(
  (
    'the an is are was be been am do does did can could will would should may me my you your we it its ' +
    'this that these those of to in on at for from by with and or if as not no what which how where there ' +
    'have has had about into than then so any one please tell get who when make made ' +
    'ka ki ke ko se mein hai hain kya aur ya mera meri mere mujhe aap ap apna apni yeh ye woh wo kis kaise ' +
    'kese kyun liye bhi na nahi nahin kar karna karun karein dena sakta sakti sakte hun hoon hoga hogi ' +
    'raha rahi rahe jo koi kitna kitni kitne agar kaun hua hui hue gaya gayi tha thi le lena lun ' +
    'میں کیا کے کی کا ہے ہیں کو سے پر اور یا میرا میری میرے مجھے آپ یہ وہ کس کیسے کیوں لیے بھی تو نہ نہیں کر ' +
    'کرنا کروں کریں دے سکتا سکتی سکتے ہوں گا گی گے رہا رہی رہے جو کوئی کتنا کتنی کتنے اگر ہو اپنا اپنی اپنے ' +
    'ایک اس ان کون سی سا چاہییں چاہیے ہوگا ہوگی لینے لوں لینا گئی گیا ہوا ہوئی'
  ).split(' '),
);

/**
 * Question words that carry meaning only in a question, so they are never indexed from a chunk
 * (there "when" is a conjunction). "Who can claim?" is how people ask about eligibility.
 */
const WHEN = new Set(['when']);
const WHO = new Set(['who', 'kaun', 'کون']);

const CANONICAL = new Map<string, string>();
const ROMAN_URDU = new Set(
  (
    'ka ki ke ko mein hai hain kya aur mera meri mere mujhe aap kaise kese kyun liye bhi nahi nahin ' +
    'karun karein sakta sakti sakte hoga hogi raha rahi kitna kitni kitne agar kaun'
  ).split(' '),
);
for (const [concept, [english, roman, urdu]] of Object.entries(CONCEPTS)) {
  for (const word of `${english} ${roman} ${urdu}`.split(' ')) CANONICAL.set(word, concept);
  for (const word of roman.split(' ')) if (word !== 'link' && word !== 'net') ROMAN_URDU.add(word);
}

/** Roman Urdu looks like English to a script check; these words say the answer should be in Urdu. */
export function isRomanUrdu(text: string) {
  return terms(text).some((word) => ROMAN_URDU.has(word));
}

/** Light English stemmer: plural, -ing, -ed, -ly. Non-Latin words are returned unchanged. */
export function stem(word: string): string {
  if (!/^[a-z]+$/.test(word) || word.length < 4) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  for (const [suffix, minimum] of [
    ['ings', 7],
    ['ing', 6],
    ['ed', 5],
    ['ly', 5],
  ] as const) {
    if (word.endsWith(suffix) && word.length >= minimum) return word.slice(0, -suffix.length);
  }
  if (/(ch|sh|ss|x)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/** One searchable token per word: the shared concept when there is one, else the stem. */
function canonical(word: string) {
  return CANONICAL.get(word) ?? CANONICAL.get(stem(word)) ?? stem(word);
}

/** Tokens of a chunk or sentence (stop words kept out so they cannot carry a match). */
export function contentTokens(text: string): string[] {
  return terms(text)
    .filter((word) => !STOP.has(word))
    .map(canonical);
}

/** Distinct tokens of a question, with the meaning of its question word added. */
export function queryTokens(raw: string): string[] {
  // Redaction placeholders are not words of the question, and "kaun si / کون سی" means "which".
  const question = raw
    .replace(/\[(CNIC|PHONE)\]/g, ' ')
    .replace(/(kaun|کون)\s*(si|sa|se|سی|سا|سے)(?![\p{L}])/giu, ' ');
  const words = terms(question);
  const tokens = contentTokens(question);
  if (words.some((word) => WHEN.has(word))) tokens.push('when');
  // Only "who" + "claim": in "who can see my data?" the other words already say what is asked.
  if (words.some((word) => WHO.has(word)) && !tokens.some((token) => token !== 'claim'))
    tokens.push('eligibl');
  return [...new Set(tokens)];
}

export type LexicalChunk = { docId: string; heading: string; content: string };
export type LexicalHit<T> = { chunk: T; score: number; coverage: number };

const K1 = 1.2;
const B = 0.75;
/** A heading or file-name word says what the chunk is about, so it counts as three body words. */
const HEADING_WEIGHT = 3;

/** Inverse document frequency of each token over the given texts (BM25 form, never negative). */
export function idfTable(texts: string[][]): (token: string) => number {
  const df = new Map<string, number>();
  for (const tokens of texts) for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = texts.length;
  return (token) => {
    const seen = df.get(token) ?? 0;
    return Math.log(1 + (n - seen + 0.5) / (seen + 0.5));
  };
}

/**
 * BM25 ranking. `coverage` is the share of the question's words found in the chunk: the caller refuses
 * below a threshold, because one shared word ("Karachi" in a weather question) is not an answer.
 */
export function rankLexical<T extends LexicalChunk>(
  question: string,
  chunks: T[],
): LexicalHit<T>[] {
  const query = queryTokens(question);
  if (!query.length || !chunks.length) return [];
  const docs = chunks.map((chunk) => {
    const tf = new Map<string, number>();
    const add = (text: string, weight: number) => {
      for (const token of contentTokens(text)) tf.set(token, (tf.get(token) ?? 0) + weight);
    };
    add(chunk.content, 1);
    add(`${chunk.docId} ${chunk.heading}`, HEADING_WEIGHT);
    return { tf, length: [...tf.values()].reduce((sum, count) => sum + count, 0) };
  });
  const idf = idfTable(docs.map((doc) => [...doc.tf.keys()]));
  const average = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length;
  return chunks
    .map((chunk, i) => {
      const { tf, length } = docs[i]!;
      let score = 0;
      let matched = 0;
      for (const token of query) {
        const count = tf.get(token);
        if (!count) continue;
        matched++;
        score += (idf(token) * count * (K1 + 1)) / (count + K1 * (1 - B + (B * length) / average));
      }
      return { chunk, score, coverage: matched / query.length };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score);
}

const OUT_OF_SCOPE: RegExp[] = [
  // An instruction to the assistant instead of a question about the program.
  /\b(ignore|disregard|forget|override|bypass)\b[^.?!]{0,40}\b(documents?|polic(y|ies)|rules?|instructions?|prompt|above|previous)\b/i,
  /\b(system prompt|developer mode|jailbreak)\b/i,
  /(دستاویزات|قواعد|ہدایات)[^۔؟]{0,30}(نظر\s*انداز|بھول)/u,
  // An order to act: the assistant can only read.
  /^\s*(please\s+)?(approve|reject|pay|cancel|delete|change|update)\b/i,
  /\b(manzoor|approve)\s+kar\s*(do|dein|den)\b/i,
  /منظور\s*کر\s*(دو|دیں)/u,
  // Somebody's personal details.
  /\b(give|tell|show|send|share)\b[^.?!]{0,40}\b(cnic|phone|mobile|address|account|iban|pin)\b[^.?!]{0,20}\bof\b/i,
  /\b(give|tell|show|send|share)\b[^.?!]{0,30}\b[a-z]+['’]s\s+(cnic|phone|mobile|address|account|iban|pin)\b/i,
];

/** Questions the policy documents must never answer, whatever words they share with them. */
export function isOutOfScope(question: string) {
  return OUT_OF_SCOPE.some((pattern) => pattern.test(question));
}
