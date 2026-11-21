/**
 * Name matching for messy records (challenge 03).
 * normalize → transliterate Urdu → fold spelling variants → drop honorifics → Jaro-Winkler.
 * A name score is evidence only: persons are keyed by CNIC hash and never merged on name.
 */

const URDU_TO_LATIN: Record<string, string> = {
  محمد: 'mhd',
  زینب: 'zainab',
  فاطمہ: 'fatima',
  عائشہ: 'ayesha',
  رشیدہ: 'rashida',
  نسرین: 'nasreen',
  شازیہ: 'shazia',
  پروین: 'parveen',
  کوثر: 'kausar',
  شمیم: 'shamim',
  علی: 'ali',
  احمد: 'ahmed',
  حسن: 'hassan',
  حسین: 'hussain',
  اسلم: 'aslam',
  خان: 'khan',
  عبد: 'abdul',
  عبدل: 'abdul',
  رحمان: 'rehman',
  رحمن: 'rehman',
  غلام: 'ghulam',
  بی: 'bibi',
  بیبی: 'bibi',
  بیگم: 'begum',
  خاتون: 'khatoon',
  مسمات: 'mst',
};

/** Spelling variants → one canonical form. */
const VARIANTS: Record<string, string> = {
  muhammad: 'mhd',
  mohammad: 'mhd',
  mohammed: 'mhd',
  muhammed: 'mhd',
  mohamad: 'mhd',
  mohamed: 'mhd',
  muhamad: 'mhd',
  mohd: 'mhd',
  md: 'mhd',
  zaynab: 'zainab',
  zenab: 'zainab',
  fatimah: 'fatima',
  aisha: 'ayesha',
  aysha: 'ayesha',
  ayisha: 'ayesha',
  husain: 'hussain',
  hussein: 'hussain',
  husein: 'hussain',
  rahman: 'rehman',
  ahmad: 'ahmed',
  khatun: 'khatoon',
  nasrin: 'nasreen',
  parvin: 'parveen',
  perveen: 'parveen',
  kauser: 'kausar',
  kousar: 'kausar',
};

/** Titles and honorific suffixes that do not identify a person. */
const HONORIFICS = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'haji', 'hajji', 'syed', 'sayyid', 'mian', 'sheikh', 'shaikh',
  'ch', 'chaudhry', 'chaudhary', 'mst', 'mussammat', 'musammat', 'bibi', 'begum', 'khatoon', 'mai',
]);

export function normalizeName(input: string): string {
  const tokens = input
    .normalize('NFKC')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => URDU_TO_LATIN[t] ?? t)
    .join(' ')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => fold(VARIANTS[t] ?? t))
    .map((t) => VARIANTS[t] ?? t);
  const meaningful = tokens.filter((t) => !HONORIFICS.has(t));
  return (meaningful.length ? meaningful : tokens).join(' ');
}

/** Fold common romanization differences: double letters, ee/oo/ou. */
function fold(token: string): string {
  return token.replace(/ee/g, 'i').replace(/oo|ou/g, 'u').replace(/(.)\1+/g, '$1');
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array<boolean>(a.length).fill(false);
  const bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(b.length - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (!bMatch[j] && a[i] === b[j]) {
        aMatch[i] = bMatch[j] = true;
        matches++;
        break;
      }
    }
  }
  if (!matches) return 0;
  let transpositions = 0;
  for (let i = 0, k = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Similarity of two raw names in [0, 1], robust to word order. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  const sorted = (s: string) => s.split(' ').sort().join(' ');
  return Math.max(jaroWinkler(na, nb), jaroWinkler(sorted(na), sorted(nb)));
}
