/** Urdu-script tokens that appear in NADRA records, mapped to their Latin spelling. */
const URDU_TOKENS: Record<string, string> = {
  محمد: 'mhd',
  زینب: 'zainab',
  بیبی: 'bibi',
  بیگم: 'begum',
  رشیدہ: 'rashida',
  شازیہ: 'shazia',
  فاطمہ: 'fatima',
  کنیز: 'kaneez',
  نسرین: 'nasreen',
  خاتون: 'khatoon',
  اکرم: 'akram',
  اسلم: 'aslam',
  علی: 'ali',
  احمد: 'ahmed',
};

const LATIN_VARIANTS: [RegExp, string][] = [
  [/\b(muhammad|mohammad|muhammed|mohammed|mohamad|mohamed|muhamad|mohd|muhd|md)\b/g, 'mhd'],
  [/\bbi\s+bi\b/g, 'bibi'],
  [/\bbegam\b/g, 'begum'],
  [/\bkhatun\b/g, 'khatoon'],
  [/\bahmad\b/g, 'ahmed'],
];

/** Vowel marks written on their own (Urdu zabar/zer/pesh): decoration, not letters. */
const LOOSE_MARKS = /\p{Mn}/gu;
/** Latin letters; an accented one is reduced to the plain letter. Urdu letters are never decomposed. */
const LATIN_LETTER = /\p{Script=Latin}/gu;
/** Titles that do not identify a person: half the women in a village are "Bibi". */
const HONORIFICS = new Set([
  'bibi',
  'begum',
  'khatoon',
  'mai',
  'mst',
  'mussammat',
  'musammat',
  'mr',
  'mrs',
  'ms',
  'haji',
  'syed',
]);
/** Words shorter than this must be equal: one letter of "Saba" / "Sana" is the whole difference. */
const MIN_SLIP_LENGTH = 6;
const VOWELS = new Set('aeiouy');
/** Ceiling for names with a word that has no counterpart: always below NAME_MATCH_THRESHOLD (0.85). */
const DIFFERENT_PERSON_MAX = 0.75;

export function normalizeName(name: string): string {
  let s = name
    .normalize('NFKC')
    .replace(LOOSE_MARKS, '')
    .replace(LATIN_LETTER, (ch) => ch.normalize('NFD').replace(LOOSE_MARKS, ''))
    .replace(/بی\s+بی/g, 'بیبی');
  s = s.replace(/[؀-ۿ]+/g, (t) => ` ${URDU_TOKENS[t] ?? t} `);
  s = s.toLowerCase().replace(/[^a-z؀-ۿ\s]/g, ' ');
  for (const [re, to] of LATIN_VARIANTS) s = s.replace(re, to);
  return s.replace(/\s+/g, ' ').trim();
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aHit = new Array<boolean>(a.length).fill(false);
  const bHit = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - window); j < Math.min(b.length, i + window + 1); j++) {
      if (bHit[j] || a[i] !== b[j]) continue;
      aHit[i] = bHit[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aHit[i]) continue;
    while (!bHit[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * A longer word written with one slip a clerk makes: a letter dropped or added ("Fatma"/"Fatima"), two
 * neighbours swapped, or one vowel for another. A changed consonant is another name ("Sakina"/"Samina").
 */
function oneSlipApart(x: string, y: string): boolean {
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (long.length < MIN_SLIP_LENGTH || long.length - short.length > 1) return false;
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  if (long.length > short.length) return short.slice(i) === long.slice(i + 1);
  if (short.slice(i + 1) === long.slice(i + 1))
    return VOWELS.has(short[i]!) && VOWELS.has(long[i]!);
  return (
    short[i] === long[i + 1] && short[i + 1] === long[i] && short.slice(i + 2) === long.slice(i + 2)
  );
}

/** One word of a name is the same word: equal, an initial of it, or one slip away. */
function sameWord(x: string, y: string): boolean {
  if (x === y) return true;
  if (x.length === 1 || y.length === 1) return x[0] === y[0];
  return oneSlipApart(x, y);
}

/** Every word of the shorter name has its own partner in the longer one. */
function wordsAgree(shorter: string[], longer: string[]): boolean {
  const free = [...longer];
  return shorter.every((w) => {
    const at = free.findIndex((f) => sameWord(w, f));
    if (at >= 0) free.splice(at, 1);
    return at >= 0;
  });
}

/** The words that identify the person; a name made only of titles keeps them. */
function identifyingWords(name: string): string[] {
  const words = normalizeName(name).split(' ').filter(Boolean);
  const core = words.filter((w) => !HONORIFICS.has(w));
  return core.length ? core : words;
}

/**
 * Similarity of two person names (0..1) after transliteration, robust to word order and titles.
 * Jaro-Winkler alone let a shared title carry the score ("Zainab Bibi" vs "Shazia Bibi" = 0.905, a match):
 * titles are dropped, and when a word of one name has no counterpart in the other the score is capped below
 * the match threshold. Names with no letters at all score 0 — two blanks are not the same person.
 */
export function nameScore(a: string, b: string): number {
  const wa = identifyingWords(a);
  const wb = identifyingWords(b);
  if (!wa.length || !wb.length) return 0;
  const joined = (w: string[]) => w.join(' ');
  const sorted = (w: string[]) => [...w].sort().join(' ');
  const score = Math.max(jaroWinkler(joined(wa), joined(wb)), jaroWinkler(sorted(wa), sorted(wb)));
  const agree =
    wa.length === wb.length
      ? wordsAgree(wa, wb) && wordsAgree(wb, wa)
      : wa.length < wb.length
        ? wordsAgree(wa, wb)
        : wordsAgree(wb, wa);
  return Math.round((agree ? score : Math.min(score, DIFFERENT_PERSON_MAX)) * 1000) / 1000;
}
