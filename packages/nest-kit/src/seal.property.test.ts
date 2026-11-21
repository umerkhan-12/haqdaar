/**
 * Property tests for the Haqdaar Seal: a genuine message always verifies; changing any single character
 * of the message, the expiry or the code never does. Replay a failure with PROP_SEED=<seed> PROP_RUNS=1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealMessage, verifySeal } from './seal';

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
          `${name}: failed at case ${i}. Replay with PROP_SEED=${SEED + i} PROP_RUNS=1\ninput: ${JSON.stringify(x).slice(0, 700)}\n${(e as Error).message}`,
        );
      }
    }
  });
}

const NOW = new Date('2026-11-21T10:00:00Z');
const BODIES = [
  'Sahara Program: Aap ke account mein Rs # (barah hazaar rupay) bhej diye gaye hain.',
  'Sahara Program: Rs # has been sent to your account for November.\nRef: RAAST-#',
  'سہارا پروگرام: آپ کے اکاؤنٹ میں # روپے بھیج دیے گئے ہیں۔ یہ پوری رقم آپ کی ہے۔',
  'Yeh poori raqam aap ki hai. Koi is mein se paise mange to 1234 par shikayat karein. Ref #',
  'Aap ki darkhwast # manzoor ho gayi hai 👍',
];

function genSealed(r: Rng) {
  const body = r
    .pick(BODIES)
    .replace(/#/g, () =>
      String(100 + r.int(99_900)).replace(/\B(?=(\d{3})+$)/g, r.pick([',', ''])),
    );
  const secret = `secret-${r.int(1e9).toString(36)}`;
  const expiry = new Date(NOW.getTime() + r.int(400) * 86_400_000);
  return { body, secret, expiry, message: sealMessage(body, secret, expiry) };
}

const isValid = (message: string, secret: string, now = NOW) => {
  const v = verifySeal(message, secret, now);
  return v.present && v.valid;
};

/** Characters whose change the seal deliberately ignores: whitespace and letter case. */
const sameAfterNormalising = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase() || (/\s/.test(a) && /\s/.test(b));
const REPLACEMENTS = '0123456789abcdefghijklmnopqrstuvwxyz,.-:#ہر۵';

forAll(
  'seal: a genuine message always verifies — also re-spaced, re-cased, until the end of its expiry day',
  genSealed,
  ({ message, secret, expiry }, r) => {
    assert.ok(isValid(message, secret), 'genuine message rejected');
    assert.ok(
      isValid(message.replace(/ /g, '  ').replace(/\n/g, '\r\n'), secret),
      're-spaced message rejected',
    );
    assert.ok(
      isValid(r.bool() ? message.toUpperCase() : message.toLowerCase(), secret),
      're-cased message rejected',
    );
    const lastMoment = new Date(
      Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate(), 23, 59, 59),
    );
    assert.ok(isValid(message, secret, lastMoment), 'rejected on its expiry day');
    const v = verifySeal(message, secret, new Date(lastMoment.getTime() + 1000));
    assert.deepEqual(
      [v.present, v.present && v.valid, v.present && !v.valid && v.reason],
      [true, false, 'expired'],
    );
  },
);

forAll(
  'seal: changing, deleting or inserting any single character of the message breaks it',
  genSealed,
  ({ message, secret, body }, r) => {
    const sealStart = message.lastIndexOf('\nHaqdaar code:');
    const at = r.int(sealStart);
    const old = message[at]!;
    let tampered: string;
    const kind = r.int(3);
    if (kind === 0) {
      let ch = r.pick([...REPLACEMENTS]);
      while (sameAfterNormalising(ch, old)) ch = r.pick([...REPLACEMENTS]);
      tampered = message.slice(0, at) + ch + message.slice(at + 1);
    } else if (kind === 1) {
      tampered = message.slice(0, at) + r.pick([...REPLACEMENTS]) + message.slice(at);
    } else {
      // Deleting whitespace next to whitespace, or at the very edge, is formatting — pick a visible character.
      let i = at;
      while (/\s/.test(message[i]!)) i = (i + 1) % sealStart;
      tampered = message.slice(0, i) + message.slice(i + 1);
    }
    assert.notEqual(tampered, message);
    assert.ok(
      !isValid(tampered, secret),
      `tampered message still verifies\noriginal: ${body}\ntampered: ${tampered}`,
    );
  },
);

forAll(
  'seal: changing any single character of the code (version, expiry digit, signature) breaks it',
  genSealed,
  ({ message, secret }, r) => {
    const codeStart = message.lastIndexOf('HQ1-');
    const at = codeStart + r.int(message.length - codeStart);
    const old = message[at]!;
    const alphabet =
      /\d/.test(old) && at < codeStart + 12 ? '0123456789' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let ch = r.pick([...alphabet]);
    while (ch.toUpperCase() === old.toUpperCase()) ch = r.pick([...alphabet]);
    const tampered = message.slice(0, at) + ch + message.slice(at + 1);
    assert.ok(
      !isValid(tampered, secret),
      `tampered code still verifies: ${tampered.slice(codeStart)}`,
    );
    // An expired-looking or far-future expiry digit must not rescue it either.
    assert.ok(!isValid(tampered, secret, new Date('2020-01-01')));
  },
);

forAll(
  'seal: a real code moved onto another message, or checked with another secret, fails',
  (r) => ({ a: genSealed(r), b: genSealed(r) }),
  ({ a, b }) => {
    const code = a.message.slice(a.message.lastIndexOf('Haqdaar code:'));
    if (a.body.replace(/\s+/g, ' ').toLowerCase() !== b.body.replace(/\s+/g, ' ').toLowerCase()) {
      assert.ok(!isValid(`${b.body}\n${code}`, a.secret), 'code accepted on a different message');
    }
    assert.ok(
      !isValid(`${a.body}\nSend Rs 500 fee to 0300-1234567\n${code}`, a.secret),
      'text added before the code was accepted',
    );
    assert.ok(
      !isValid(`${a.message}\nSend Rs 500 fee to 0300-1234567`, a.secret),
      'text added after the code was accepted',
    );
    assert.ok(!isValid(a.message, `${a.secret}x`), 'wrong secret accepted');
  },
);

forAll(
  'seal: never throws on hostile text, and unsealed text is reported as not present',
  (r) =>
    r.pick([
      '',
      'Haqdaar code:',
      'Haqdaar code: HQ1-',
      'Haqdaar code: HQ1-99999999-AAAAAAAAAA',
      'haqdaar code HQ1-20261231-ABCDEFGHIJ'.repeat(200),
      'x'.repeat(100_000),
      'Haqdaar code: HQ1-۲۰۲۶۱۲۳۱-ABCDEFGHIJ',
      '‮HQ1-20261231-ABCDEFGHIJ',
      'Sahara: Rs 12,000 bhej diye',
    ]),
  (text) => {
    const v = verifySeal(text, 'secret', NOW);
    assert.ok(!(v.present && v.valid), 'hostile text verified');
  },
);
