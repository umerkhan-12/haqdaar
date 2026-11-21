/**
 * Account-title vs beneficiary name matching (mule account detection).
 * Pakistani names vary in spelling and order, so we normalize common transliterations,
 * then take the best Jaro-Winkler score of the names as written and with tokens sorted.
 */
export const TITLE_MATCH_THRESHOLD = 0.85;

const VARIANTS: Array<[RegExp, string]> = [
  [/\b(muhammad|mohammad|muhammed|mohammed|mohamad|mohamed|muhamad|mohd|muhd|md)\b/g, 'mhd'],
  [/\b(begum|begam|baigum|begem)\b/g, 'begum'],
  [/\b(bibi|bibbi|bebi)\b/g, 'bibi'],
  [/\b(syed|sayed|syyed|sayyed|syed)\b/g, 'syed'],
  [/\b(khatoon|khatun|khaton)\b/g, 'khatoon'],
  [/\b(abdul|abdool|abdel)\b/g, 'abdul'],
];

export function normalizeName(name: string): string {
  let n = name.toLowerCase().replace(/[^a-z\s]/g, ' ');
  for (const [re, to] of VARIANTS) n = n.replace(re, to);
  return n.replace(/\s+/g, ' ').trim();
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length ? 1 : 0;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aHit = new Array<boolean>(a.length).fill(false);
  const bHit = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (!bHit[j] && a[i] === b[j]) {
        aHit[i] = bHit[j] = true;
        matches++;
        break;
      }
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
 * Word-by-word agreement: every word of the shorter name must have a partner in the other name; the
 * weakest pair is returned. Whole-string similarity alone lets a shared family word or suffix (Bibi,
 * Khan) carry two different people over the line: "Zainab Bibi" and "Shazia Bibi" look 90% alike as
 * strings, but Zainab has no partner at all.
 */
function weakestWordMatch(a: string, b: string): number {
  const pair = (short: string[], long: string[]): number => {
    const free = [...long];
    let weakest = 1;
    for (const word of short) {
      let best = 0;
      let at = -1;
      free.forEach((other, i) => {
        const s = jaroWinkler(word, other);
        if (s >= best) [best, at] = [s, i];
      });
      if (at >= 0) free.splice(at, 1);
      weakest = Math.min(weakest, best);
    }
    return weakest;
  };
  const [x, y] = [a.split(' '), b.split(' ')];
  if (x.length < y.length) return pair(x, y);
  if (y.length < x.length) return pair(y, x);
  // Same number of words: the order must not matter, so take the stricter of the two pairings.
  return Math.min(pair(x, y), pair(y, x));
}

/**
 * Below this, a word is not a spelling variant of its partner: it is a different word. Honest variants
 * score 0.93+ (Zainab/Zaynab, Parveen/Perveen); look-alike names of other people score 0.80-0.87
 * (Hameeda/Jameela, Sughra/Bushra). A miss only holds the payout for an officer, it never rejects.
 */
const DIFFERENT_WORD = 0.88;

/**
 * A spelling slip in one word keeps the whole-name score (so honest variants are judged as before);
 * a word with no real partner caps the score at that word's match, however alike the rest looks.
 */
function withWordCheck(whole: number, a: string, b: string): number {
  const weakest = weakestWordMatch(a, b);
  return weakest < DIFFERENT_WORD ? Math.min(whole, weakest) : whole;
}

const sortTokens = (s: string) => s.split(' ').sort().join(' ');

/** 0..1, rounded to 3 decimals. */
export function nameMatchScore(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  const whole = Math.max(jaroWinkler(na, nb), jaroWinkler(sortTokens(na), sortTokens(nb)));
  const score = withWordCheck(whole, na, nb);
  return Math.round(score * 1000) / 1000;
}
