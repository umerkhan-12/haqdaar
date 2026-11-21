/**
 * Property tests for the mock NADRA name check: the same person written differently must match,
 * and two different people must never look like one — whatever script, spelling or title is used.
 * Replay a failure with PROP_SEED=<seed printed in the failure> PROP_RUNS=1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAME_MATCH_THRESHOLD } from './rails.store';
import { nameScore, normalizeName } from './names';

const SEED = Number(process.env.PROP_SEED ?? 20261121);
const RUNS = Number(process.env.PROP_RUNS ?? 2500);

/** mulberry32: a tiny seeded PRNG, so a failing case is reproducible from its seed alone. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    bool: (p = 0.5) => next() < p,
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
  };
}
type Rng = ReturnType<typeof rng>;

function forAll<T>(name: string, gen: (r: Rng) => T, check: (x: T, r: Rng) => void): void {
  test(`${name} [${RUNS} cases, seed ${SEED}]`, () => {
    for (let i = 0; i < RUNS; i++) {
      const r = rng(SEED + i);
      const x = gen(r);
      try {
        check(x, r);
      } catch (e) {
        throw new Error(
          `${name}: failed at case ${i}. Replay with PROP_SEED=${SEED + i} PROP_RUNS=1\ninput: ${JSON.stringify(x).slice(0, 600)}\n${(e as Error).message}`,
        );
      }
    }
  });
}

/** Different given names: no two are spellings of each other, though several sound alike (Saima/Samina, Farida/Fahmida). */
const FEMALE = [
  'Zainab',
  'Rashida',
  'Nasreen',
  'Shazia',
  'Parveen',
  'Kausar',
  'Shamim',
  'Fatima',
  'Ayesha',
  'Kaneez',
  'Sakina',
  'Rukhsana',
  'Tahira',
  'Bushra',
  'Naheed',
  'Saima',
  'Samina',
  'Farida',
  'Fahmida',
  'Khadija',
  'Maryam',
  'Sughra',
  'Zubaida',
  'Hajra',
  'Gulshan',
  'Razia',
  'Salma',
  'Najma',
  'Hameeda',
  'Jameela',
  'Shabana',
  'Rehana',
  'Farzana',
  'Rizwana',
  'Nusrat',
  'Mumtaz',
  'Yasmeen',
];
const MALE_SECOND = [
  'Aslam',
  'Akram',
  'Rasool',
  'Qadir',
  'Iqbal',
  'Hussain',
  'Rehman',
  'Yousaf',
  'Saleem',
  'Nadeem',
  'Tariq',
  'Bashir',
  'Nazir',
  'Farooq',
  'Majid',
  'Sajid',
  'Wajid',
  'Irshad',
  'Rashid',
  'Anwar',
  'Ansar',
  'Ikram',
  'Azam',
];
const HONORIFIC = ['Bibi', 'Begum', 'Khatoon', 'Mai'];
const MUHAMMAD = [
  'Muhammad',
  'Mohammad',
  'Muhammed',
  'Mohammed',
  'Mohd',
  'Mohd.',
  'MD',
  'Md.',
  'Mohamed',
  'Mohamad',
  'Muhamad',
  'محمد',
];
/** Real Urdu-script names the transliteration table does not know. */
const URDU_UNKNOWN = [
  'ثمینہ ناز',
  'نادیہ اقبال',
  'صائمہ قریشی',
  'روبینہ شاہین',
  'نگہت سلطانہ',
  'طاہرہ یاسمین',
  'فرزانہ کوکب',
  'ممتاز مائی',
];
const HOSTILE = [
  '',
  ' ',
  '\t\n',
  '۱۲۳۴۵',
  '12345',
  '@@@###',
  '👩‍👧‍👦',
  '‮‏',
  "'; DROP TABLE persons;--",
  'x'.repeat(20_000),
  '__proto__',
  'null',
  'بی بی',
  'Mst.',
];

const two = <T>(r: Rng, xs: readonly T[]): [T, T] => {
  const i = r.int(xs.length);
  const j = (i + 1 + r.int(xs.length - 1)) % xs.length;
  return [xs[i]!, xs[j]!];
};

/** The same person, written the way a tired clerk or a speech recogniser would. */
function disguise(name: string, r: Rng): string {
  const steps: ((s: string) => string)[] = [
    (s) => s.toUpperCase(),
    (s) => s.toLowerCase(),
    (s) => `  ${s.split(' ').join('   ')} `,
    (s) => s.split(' ').reverse().join(' '),
    (s) => `Mst. ${s}`,
    (s) => `${s} ${r.pick(HONORIFIC)}`,
    (s) => s.replace(/ (Bibi|Begum|Khatoon|Mai)$/i, ` ${r.pick(HONORIFIC)}`),
    (s) => s.replace(/ (Bibi|Begum|Khatoon|Mai)$/i, ''),
    (s) => s.replace(/\b(Muhammad)\b/i, r.pick(MUHAMMAD)),
    (s) => s.replace(/a/, r.pick(['á', 'à', 'â', 'ā'])).replace(/i/, r.pick(['í', 'ï', 'ī'])),
    (s) => s.replace(/ /g, r.pick(['-', '.  ', ' , ', ' '])),
    (s) => `${s}.`,
    (s) => s.replace(/\bBibi\b/i, 'Bi Bi'),
  ];
  let out = name;
  for (let k = 1 + r.int(3); k > 0; k--) out = r.pick(steps)(out);
  return out;
}

const person = (r: Rng): string =>
  r.bool(0.7)
    ? `${r.pick(FEMALE)} ${r.pick(HONORIFIC)}`
    : `${r.pick(['Muhammad', 'Ghulam', 'Abdul'])} ${r.pick(MALE_SECOND)}`;

forAll(
  'names: never throws, score in [0,1], symmetric — for any two strings',
  (r) => {
    const any = () =>
      r.bool(0.4) ? r.pick(HOSTILE) : r.bool(0.2) ? r.pick(URDU_UNKNOWN) : disguise(person(r), r);
    return [any(), any()] as const;
  },
  ([a, b]) => {
    const ab = nameScore(a, b);
    assert.ok(ab >= 0 && ab <= 1, `score ${ab}`);
    assert.equal(ab, nameScore(b, a), 'not symmetric');
    assert.equal(typeof normalizeName(a), 'string');
  },
);

forAll(
  'names: identical names score 1; case, spacing, punctuation, diacritics, titles, word order and Muhammad spellings do not matter',
  (r) => {
    const name = person(r);
    return [name, disguise(name, r)] as const;
  },
  ([name, variant]) => {
    assert.equal(nameScore(name, name), 1);
    assert.equal(
      nameScore(name, variant),
      1,
      `"${name}" vs "${variant}" → ${nameScore(name, variant)} (normalized "${normalizeName(name)}" / "${normalizeName(variant)}")`,
    );
  },
);

forAll(
  'names: two different people never reach the match threshold, even with the same title or the same first word',
  (r) => {
    if (r.bool(0.65)) {
      const [a, b] = two(r, FEMALE);
      const h = r.pick(HONORIFIC);
      return [`${a} ${h}`, `${b} ${r.bool(0.7) ? h : r.pick(HONORIFIC)}`] as const;
    }
    const [a, b] = two(r, MALE_SECOND);
    const first = r.pick(MUHAMMAD);
    return [`${first} ${a}`, `${r.bool(0.7) ? first : r.pick(MUHAMMAD)} ${b}`] as const;
  },
  ([a, b], r) => {
    for (const [x, y] of [
      [a, b],
      [disguise(a, r), b],
      [a, disguise(b, r)],
    ] as const) {
      const s = nameScore(x, y);
      assert.ok(
        s < NAME_MATCH_THRESHOLD,
        `"${x}" vs "${y}" → ${s.toFixed(3)} ≥ ${NAME_MATCH_THRESHOLD}: two different people look like one`,
      );
    }
  },
);

forAll(
  'names: names the transliteration table does not know (other Urdu names, digits, emoji) never match a different name',
  (r) => {
    const pool = [
      ...URDU_UNKNOWN,
      ...HOSTILE.filter((h) => h.trim() && h.length < 100),
      'Zainab Bibi',
    ];
    return two(r, pool);
  },
  ([a, b]) => {
    const s = nameScore(a, b);
    assert.ok(
      s < NAME_MATCH_THRESHOLD,
      `"${a}" vs "${b}" → ${s.toFixed(3)}: unrelated strings look like the same person`,
    );
  },
);

test('names: strings with no letters at all are not a name match', () => {
  for (const [a, b] of [
    ['', ''],
    ['123', '456'],
    ['@@', '!!'],
    ['۱۲۳', ''],
    ['   ', '\t'],
  ] as const) {
    assert.equal(nameScore(a, b), 0, `"${a}" vs "${b}"`);
  }
});

test('names: an Urdu-script name matches itself and its vowel-marked spelling', () => {
  for (const n of URDU_UNKNOWN) assert.equal(nameScore(n, n), 1);
  assert.equal(nameScore('زَینب بی بی', 'Zainab Bibi'), 1);
});
