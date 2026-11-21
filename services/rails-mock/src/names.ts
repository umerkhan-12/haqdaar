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
  [/\b(muhammad|mohammad|muhammed|mohammed|mohamad|muhamad|mohd|muhd|md)\b/g, 'mhd'],
  [/\bbi\s+bi\b/g, 'bibi'],
  [/\bbegam\b/g, 'begum'],
  [/\bkhatun\b/g, 'khatoon'],
  [/\bahmad\b/g, 'ahmed'],
];

export function normalizeName(name: string): string {
  let s = name.replace(/بی\s+بی/g, 'بیبی');
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

/** Similarity of two person names (0..1) after transliteration, robust to word order. */
export function nameScore(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  const sorted = (s: string) => s.split(' ').sort().join(' ');
  const score = Math.max(jaroWinkler(na, nb), jaroWinkler(sorted(na), sorted(nb)));
  return Math.round(score * 1000) / 1000;
}
