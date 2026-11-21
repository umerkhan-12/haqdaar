import { URDU_TO_LATIN } from '../engine/names';
import type { prng } from './dataset';

type Rng = ReturnType<typeof prng>;

const FEMALE = [
  'Zainab',
  'Fatima',
  'Ayesha',
  'Rashida',
  'Nasreen',
  'Shazia',
  'Parveen',
  'Kausar',
  'Shamim',
  'Kaneez',
  'Sughran',
  'Hajra',
  'Saima',
  'Naseem',
  'Rubina',
  'Samina',
  'Razia',
  'Bushra',
  'Nargis',
  'Zubaida',
  'Amina',
  'Khadija',
  'Khalida',
  'Hameeda',
  'Jamila',
  'Sakina',
];
const FEMALE_SECOND = [
  'Bibi',
  'Begum',
  'Khatoon',
  'Mai',
  'Bano',
  'Akhtar',
  'Parveen',
  'Kausar',
  'Sultana',
  'Fatima',
];
const MALE = ['Muhammad', 'Ghulam', 'Allah', 'Abdul', 'Ali'];
const MALE_SECOND = [
  'Aslam',
  'Akram',
  'Rasool',
  'Qadir',
  'Ditta',
  'Rakha',
  'Rehman',
  'Rauf',
  'Iqbal',
  'Hussain',
  'Ahmed',
];

/** Spellings seen in real records. Some the normaliser knows, some it does not (Akhter, Sughra, Fatma…). */
const VARIANTS: Record<string, string[]> = {
  Zainab: ['Zaynab', 'Zenab', 'Zainb'],
  Fatima: ['Fatimah', 'Fatma'],
  Ayesha: ['Aisha', 'Aysha'],
  Nasreen: ['Nasrin'],
  Parveen: ['Parvin', 'Perveen'],
  Kausar: ['Kauser', 'Kousar'],
  Muhammad: ['Mohd.', 'Mohammed', 'Muhammed', 'Mohammad'],
  Hussain: ['Husain', 'Hussein'],
  Rehman: ['Rahman'],
  Ahmed: ['Ahmad'],
  Khatoon: ['Khatun'],
  Hameeda: ['Hamida'],
  Akhtar: ['Akhter'],
  Sughran: ['Sughra'],
  Hajra: ['Hajran', 'Hajira'],
  Sultana: ['Sultan'],
  Shamim: ['Shameem'],
  Rasool: ['Rasul'],
  Jamila: ['Jameela'],
  Sakina: ['Sakeena'],
};

const LATIN_TO_URDU: Record<string, string> = {};
for (const [ur, la] of Object.entries(URDU_TO_LATIN)) LATIN_TO_URDU[la] ??= ur;
LATIN_TO_URDU.muhammad = LATIN_TO_URDU.mhd;

export function personName(r: Rng): string {
  if (r.chance(0.8)) {
    const first = r.pick(FEMALE);
    const second = r.pick(FEMALE_SECOND.filter((s) => s !== first));
    return `${first} ${second}`;
  }
  return `${r.pick(MALE)} ${r.pick(MALE_SECOND)}`;
}

/**
 * A relative sharing one name token — the hardest impersonation to spot by name.
 * Sisters share the second name (Rubina / Samina Akhtar); brothers share the first (Muhammad Aslam / Akram).
 */
export function relatedName(record: string, r: Rng): string {
  const [first, second] = record.split(' ');
  const male = MALE.includes(first);
  for (;;) {
    const name = male ? `${first} ${r.pick(MALE_SECOND)}` : `${r.pick(FEMALE)} ${second}`;
    if (name !== record) return name;
  }
}

/** A stranger's name. */
export function otherName(record: string, r: Rng): string {
  for (;;) {
    const name = personName(r);
    if (!name.split(' ').some((t) => record.includes(t))) return name;
  }
}

/** How the claimant (or a helper typing for her) writes her own name: `edits` small changes. */
export function writtenAs(record: string, edits: number, r: Rng): string {
  let tokens = record.split(' ');
  for (let k = 0; k < edits; k++) {
    const kind = r.next();
    const i = r.int(0, tokens.length - 1);
    if (kind < 0.35 && VARIANTS[tokens[i]]) tokens[i] = r.pick(VARIANTS[tokens[i]]);
    else if (kind < 0.55) tokens[i] = typo(tokens[i], r);
    else if (kind < 0.7 && tokens.length > 1) tokens = [...tokens].reverse();
    else if (kind < 0.85 && tokens.length > 1)
      tokens = tokens.filter((_, j) => j !== tokens.length - 1);
    else tokens = [...tokens, r.pick(FEMALE_SECOND)];
  }
  const out = tokens.join(' ');
  // cosmetic only: case, title, Urdu script
  const c = r.next();
  if (c < 0.15) return out.toUpperCase();
  if (c < 0.25) return `Mst. ${out}`;
  if (c < 0.35) {
    const ur = out
      .toLowerCase()
      .split(' ')
      .map((t) => LATIN_TO_URDU[t]);
    if (ur.every(Boolean)) return ur.join(' ');
  }
  return out;
}

function typo(token: string, r: Rng): string {
  if (token.length < 4) return token;
  const i = r.int(1, token.length - 2);
  const kind = r.next();
  if (kind < 0.4) return token.slice(0, i) + token.slice(i + 1); // dropped letter
  if (kind < 0.7) return token.slice(0, i) + token[i] + token.slice(i); // doubled letter
  const letters = 'aeiouhnrs';
  return token.slice(0, i) + letters[r.int(0, letters.length - 1)] + token.slice(i + 1); // wrong letter
}
