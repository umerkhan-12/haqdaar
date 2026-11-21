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

const sortTokens = (s: string) => s.split(' ').sort().join(' ');

/** 0..1, rounded to 3 decimals. */
export function nameMatchScore(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  const score = Math.max(jaroWinkler(na, nb), jaroWinkler(sortTokens(na), sortTokens(nb)));
  return Math.round(score * 1000) / 1000;
}
