import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupHash } from '@haqdaar/nest-kit';
import { LoginRequest, SignupStartRequest, SignupVerifyRequest } from '@haqdaar/shared';
import { AuthService, normalizePhone } from './auth.service';
import { checkCode, hashCode, MAX_CODE_TRIES, newCode, type CodeRow } from './signup-code';
import { env } from '../env';

const KEY = 'ab'.repeat(32);
const PHONE = '923451234567';
const now = new Date('2026-11-21T10:00:00Z');
const row = (over: Partial<CodeRow> = {}): CodeRow => ({
  codeHash: hashCode(PHONE, '123456', KEY),
  expiresAt: new Date(now.getTime() + 5 * 60_000),
  attempts: 1,
  usedAt: null,
  ...over,
});

test('sign-up code: 6 digits, stored only as a hash bound to the phone', () => {
  for (let i = 0; i < 50; i++) assert.match(newCode(), /^\d{6}$/);
  const h = hashCode(PHONE, '123456', KEY);
  assert.doesNotMatch(h, /123456/);
  assert.notEqual(
    h,
    hashCode('923451234568', '123456', KEY),
    'a code for one phone is useless for another',
  );
  assert.equal(checkCode(row(), h, now), 'ok');
  assert.equal(checkCode(null, h, now), 'missing');
});

test('sign-up code expires after 5 minutes, even with the right digits', () => {
  const h = hashCode(PHONE, '123456', KEY);
  assert.equal(checkCode(row(), h, new Date(now.getTime() + 4 * 60_000 + 59_000)), 'ok');
  assert.equal(checkCode(row(), h, new Date(now.getTime() + 5 * 60_000)), 'expired');
});

test('sign-up code: 5 tries, then it is dead; a used code cannot be used again', () => {
  const right = hashCode(PHONE, '123456', KEY);
  const wrong = hashCode(PHONE, '000000', KEY);
  assert.equal(checkCode(row({ attempts: 1 }), wrong, now), 'wrong');
  assert.equal(
    checkCode(row({ attempts: MAX_CODE_TRIES }), right, now),
    'ok',
    'the 5th try still counts',
  );
  assert.equal(checkCode(row({ attempts: MAX_CODE_TRIES + 1 }), right, now), 'locked');
  assert.equal(checkCode(row({ usedAt: now }), right, now), 'used');
});

test('sign-up bodies: mobile 03XXXXXXXXX, 6-digit code, 4-digit PIN; login accepts the PIN', () => {
  assert.equal(SignupStartRequest.safeParse({ phone: '03451234567' }).success, true);
  for (const phone of ['3451234567', '+923451234567', '0345123456', '04451234567', '0345-1234567'])
    assert.equal(SignupStartRequest.safeParse({ phone }).success, false, phone);
  const ok = { phone: '03451234567', code: '123456', fullName: 'Sakina Bibi', pin: '4821' };
  assert.equal(SignupVerifyRequest.safeParse(ok).success, true);
  assert.equal(SignupVerifyRequest.safeParse({ ...ok, code: '12345' }).success, false);
  assert.equal(SignupVerifyRequest.safeParse({ ...ok, pin: '12345' }).success, false);
  assert.equal(SignupVerifyRequest.safeParse({ ...ok, fullName: ' ' }).success, false);
  assert.equal(LoginRequest.safeParse({ phone: '03451234567', password: '4821' }).success, true);
});

type StoredCode = CodeRow & { phoneHash: string };

/** AuthService with in-memory fakes: enough to exercise the sign-up paths without a database. */
function harness(registered: string[] = []) {
  const users = new Set(registered.map((p) => lookupHash(normalizePhone(p), env.PII_HASH_KEY)));
  const codes = new Map<string, StoredCode>();
  const sms: { to: string; body: string; from: string }[] = [];
  const events: string[] = [];
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { phoneHash: string } }) =>
        users.has(where.phoneHash) ? { id: 'u1' } : null,
      create: async ({ data }: { data: { phoneHash: string } }) => {
        if (users.has(data.phoneHash)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        users.add(data.phoneHash);
        return { id: 'new-user', ...data };
      },
    },
    signupCode: {
      upsert: async ({ create }: { create: StoredCode }) =>
        void codes.set(create.phoneHash, { ...create }),
      findUnique: async ({ where }: { where: { phoneHash: string } }) =>
        codes.get(where.phoneHash) ?? null,
      updateMany: async (q: {
        where: { phoneHash: string; attempts?: { lte: number } };
        data: { attempts?: unknown; usedAt?: Date };
      }) => {
        const r = codes.get(q.where.phoneHash);
        if (!r || r.usedAt || (q.where.attempts && r.attempts > q.where.attempts.lte))
          return { count: 0 };
        if (q.data.attempts) r.attempts += 1;
        if (q.data.usedAt) r.usedAt = q.data.usedAt;
        return { count: 1 };
      },
    },
    outboxEvent: {
      create: async ({ data }: { data: { type: string } }) => void events.push(data.type),
    },
    refreshToken: { create: async () => undefined },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
  };
  const client = {
    call: async (_t: string, _p: string, o: { body: (typeof sms)[number] }) =>
      void sms.push(o.body),
  };
  const auth = new AuthService(
    prisma as never,
    { kick: () => undefined } as never,
    client as never,
  );
  return { auth, sms, codes, events, users };
}
const codeIn = (body: string) => /\b(\d{6})\b/.exec(body)?.[1];
const BODY = { phone: '03451234567', fullName: 'Sakina Bibi', pin: '4821' };

test('sign-up start: same answer for a new and a registered phone; the registered one gets no code', async () => {
  const h = harness(['03001110001']);
  assert.deepEqual(await h.auth.signupStart('03451234567'), { sent: true });
  assert.deepEqual(await h.auth.signupStart('03001110001'), { sent: true });
  assert.equal(h.sms.length, 2);
  assert.ok(codeIn(h.sms[0]!.body), 'new phone gets a code');
  assert.equal(codeIn(h.sms[1]!.body), undefined, 'registered phone is told to log in, no code');
  assert.equal(h.codes.size, 1, 'no code stored for a registered phone');
  assert.equal(h.sms[0]!.from, 'HAQDAAR');
});

test('sign-up verify: a wrong try is refused, the right code works once, then the phone is taken', async () => {
  const h = harness();
  await h.auth.signupStart(BODY.phone);
  const code = codeIn(h.sms[0]!.body)!;
  const wrong = code === '000000' ? '111111' : '000000';

  await assert.rejects(h.auth.signupVerify({ ...BODY, code: wrong }), /Wrong or expired code/);
  const pair = await h.auth.signupVerify({ ...BODY, code });
  assert.ok(pair.accessToken && pair.refreshToken);
  assert.deepEqual(h.events, ['identity.user.registered']);

  await assert.rejects(
    h.auth.signupVerify({ ...BODY, code }),
    /Wrong or expired code/,
    'single use',
  );
  await h.auth.signupStart(BODY.phone);
  assert.equal(
    codeIn(h.sms[1]!.body),
    undefined,
    'the number is registered now: no second account',
  );
});

test('sign-up verify: after 5 wrong tries even the right code is refused', async () => {
  const h = harness();
  await h.auth.signupStart(BODY.phone);
  const code = codeIn(h.sms[0]!.body)!;
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++)
    await assert.rejects(h.auth.signupVerify({ ...BODY, code: wrong }), /Wrong or expired code/);
  await assert.rejects(h.auth.signupVerify({ ...BODY, code }), /Too many wrong codes/);
  assert.equal(h.users.size, 0);
});
