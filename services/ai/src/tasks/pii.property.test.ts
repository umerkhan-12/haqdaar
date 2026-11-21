/**
 * Property tests for PII redaction: no CNIC and no Pakistani mobile number, in any common way of writing
 * it, survives into the text that is sent to an external model; text without PII is left alone.
 * Replay a failure with PROP_SEED=<seed printed in the failure> PROP_RUNS=1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDigits, redactPii } from './pii';

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

/** Returns failures instead of throwing, so one run reports how many generated cases broke and the first seeds. */
function sweep<T>(gen: (r: Rng) => T, check: (x: T) => void): { failed: number; first: string[] } {
  let failed = 0;
  const first: string[] = [];
  for (let i = 0; i < RUNS; i++) {
    const x = gen(rng(SEED + i));
    try {
      check(x);
    } catch (e) {
      failed++;
      if (first.length < 3)
        first.push(
          `PROP_SEED=${SEED + i} PROP_RUNS=1 input=${JSON.stringify(x).slice(0, 300)} → ${(e as Error).message}`,
        );
    }
  }
  return { failed, first };
}

function forAll<T>(
  name: string,
  gen: (r: Rng) => T,
  check: (x: T) => void,
  opts: { todo?: string } = {},
): void {
  test(`${name} [${RUNS} cases, seed ${SEED}]`, opts, () => {
    const { failed, first } = sweep(gen, check);
    assert.equal(
      failed,
      0,
      `${name}: ${failed}/${RUNS} generated cases failed. First:\n${first.join('\n')}`,
    );
  });
}

const digits = (r: Rng, n: number) => Array.from({ length: n }, () => r.int(10)).join('');
const urdu = (s: string) => s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!);
const arabic = (s: string) => s.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]!);
const script = (r: Rng, s: string) => r.pick([s, s, urdu(s), arabic(s)]);
const onlyDigits = (s: string) => normalizeDigits(s).replace(/\D/g, '');

interface Pii {
  shown: string;
  /** Digits that must not survive redaction. */
  secret: string;
  canonical: string;
}

function genCnic(r: Rng): Pii {
  const [a, b, c] = [`${1 + r.int(9)}${digits(r, 4)}`, digits(r, 7), digits(r, 1)];
  const shown = r.pick([
    `${a}-${b}-${c}`,
    `${a}${b}${c}`,
    `${a} ${b} ${c}`,
    `${a}-${b}${c}`,
    `${a} ${b}-${c}`,
  ]);
  return { shown: script(r, shown), secret: `${a}${b}${c}`, canonical: `${a}-${b}-${c}` };
}

/** 03xx…, +923xx…, 923xx…, 00923xx… with the usual 4+7 grouping, dashes or spaces. */
function genPhone(r: Rng): Pii {
  const op = `3${digits(r, 2)}`;
  const rest = digits(r, 7);
  const sep = r.pick(['', '', '-', ' ']);
  const shown = r.pick([
    `0${op}${sep}${rest}`,
    `+92${op}${sep}${rest}`,
    `+92 ${op} ${rest}`,
    `+92-${op}-${rest}`,
    `92${op}${rest}`,
    `0092${op}${rest}`,
  ]);
  return { shown: script(r, shown), secret: `${op}${rest}`, canonical: `0${op}${rest}` };
}

/** Sentences a citizen says or forwards; `#` is where the number goes. */
const CNIC_SENTENCES = [
  'میرا شناختی کارڈ نمبر # ہے',
  'میرا نام زینب بی بی ہے اور کارڈ # ہے، ٹھٹھہ سے ہوں',
  'شناختی کارڈ: #۔',
  'Mera shanakhti card number # hai',
  'mera naam Zainab hai, CNIC # hai aur ghar mein 5 log hain',
  'My CNIC is #.',
  'CNIC: #, district Thatta',
  'CNIC (#) please check my payment of Rs 12,000',
  '#',
  'cnic\n#\nshukriya',
];
const PHONE_SENTENCES = [
  'میرا موبائل نمبر # ہے',
  'اس نمبر پر پیسے بھیجیں: #',
  'رابطہ # پر کریں۔',
  'Mera number # hai',
  'Easypaisa # par bhej dein',
  'Call me on # tomorrow.',
  'Phone: #, name Rashida Begum',
  'mobile (#)',
  '#',
];
const CLEAN = [
  'میرا نام زینب بی بی ہے، میں ٹھٹھہ سے ہوں',
  'مجھے بارہ ہزار روپے ملنے ہیں',
  'Mera naam Zainab hai aur ghar mein 5 log hain',
  'Mujhe Rs 12,000 milne hain, 21-11-2026 ko darkhwast di thi',
  'My household has 7 members and income is 18000 rupees.',
  'Helpline 1234 par call karein',
  'Ref: RAAST-20261121-000042',
  'Haqdaar code: HQ1-20261231-AB12CD34EF',
  'گھر میں ۵ افراد ہیں اور آمدن ۱۸۰۰۰ روپے ہے',
  '👩‍👧‍👦 shukriya 🙏',
  '',
];

const place = (r: Rng, sentences: readonly string[], p: Pii) =>
  r.pick(sentences).replace('#', p.shown);

forAll(
  'pii: every CNIC (dashes, no dashes, spaces, Urdu/Arabic digits) is removed from Urdu / Roman Urdu / English sentences',
  (r) => {
    const p = genCnic(r);
    return { text: place(r, CNIC_SENTENCES, p), p };
  },
  ({ text, p }) => {
    const out = redactPii(text);
    assert.ok(!onlyDigits(out.text).includes(p.secret), `CNIC digits survive: "${out.text}"`);
    assert.deepEqual(out.cnics, [p.canonical]);
    assert.ok(out.text.includes('[CNIC_1]'));
  },
);

forAll(
  'pii: every mobile number (03xx, +923xx, 923xx, 00923xx, Urdu/Arabic digits) is removed',
  (r) => {
    const p = genPhone(r);
    return { text: place(r, PHONE_SENTENCES, p), p };
  },
  ({ text, p }) => {
    const out = redactPii(text);
    assert.ok(!onlyDigits(out.text).includes(p.secret), `phone digits survive: "${out.text}"`);
    assert.deepEqual(out.phones, [p.canonical]);
  },
);

forAll(
  'pii: a CNIC and a phone number in the same message are both removed, in any order',
  (r) => {
    const c = genCnic(r);
    const p = genPhone(r);
    const parts = [place(r, CNIC_SENTENCES, c), place(r, PHONE_SENTENCES, p)];
    return {
      text: (r.bool() ? parts : parts.reverse()).join(r.pick([' ', '۔ ', '. ', '\n', ', '])),
      c,
      p,
    };
  },
  ({ text, c, p }) => {
    const out = redactPii(text);
    const left = onlyDigits(out.text);
    assert.ok(!left.includes(c.secret) && !left.includes(p.secret), `PII survives: "${out.text}"`);
    assert.deepEqual([out.cnics, out.phones], [[c.canonical], [p.canonical]]);
  },
);

forAll(
  'pii: text without PII is unchanged (apart from Urdu digits being written as 0-9)',
  (r) => Array.from({ length: 1 + r.int(3) }, () => r.pick(CLEAN)).join(r.pick([' ', '\n', '۔ '])),
  (text) => {
    const out = redactPii(text);
    assert.equal(out.text, normalizeDigits(text));
    assert.deepEqual([out.cnics, out.phones], [[], []]);
    if (!/[۰-۹٠-٩]/.test(text)) assert.equal(out.text, text);
  },
);

forAll(
  'pii: never throws and never invents PII on hostile input',
  (r) =>
    r.pick([
      '',
      ' ',
      'x'.repeat(100_000),
      '0'.repeat(5000),
      '-'.repeat(3000),
      '‮‏',
      '👩‍👧‍👦'.repeat(500),
      '۰'.repeat(2000),
      '{"$ne":null}',
      "'; DROP TABLE--",
    ]),
  (text) => {
    const out = redactPii(text);
    assert.equal(typeof out.text, 'string');
    assert.equal(out.cnics.length + out.phones.length, 0);
  },
);

// ---------- grouped and glued numbers (found by these tests, fixed in pii.ts) ----------

forAll(
  'pii: phone numbers grouped 0300-123-4567 / 0300 123 4567 are removed',
  (r) => {
    const [op, a, b] = [`3${digits(r, 2)}`, digits(r, 3), digits(r, 4)];
    const sep = r.pick(['-', ' ']);
    const p: Pii = {
      shown: script(r, `0${op}${sep}${a}${sep}${b}`),
      secret: `${op}${a}${b}`,
      canonical: `0${op}${a}${b}`,
    };
    return { text: place(r, PHONE_SENTENCES, p), p };
  },
  ({ text, p }) => {
    assert.ok(!onlyDigits(redactPii(text).text).includes(p.secret), 'phone digits survive');
  },
);

forAll(
  'pii: a CNIC or phone glued to Latin letters or an underscore (cnic42201…, no_0300…) is removed',
  (r) => {
    const p = r.bool() ? genCnic(r) : genPhone(r);
    return {
      text: `${r.pick(['cnic', 'CNIC', 'no', 'id_', 'card'])}${normalizeDigits(p.shown).replace(/^\+/, '')}${r.pick(['', 'hai', '_x'])}`,
      p,
    };
  },
  ({ text, p }) => {
    assert.ok(!onlyDigits(redactPii(text).text).includes(p.secret), 'digits survive');
  },
);
