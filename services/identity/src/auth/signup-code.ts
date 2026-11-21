import { randomInt } from 'node:crypto';
import { lookupHash, safeEqual } from '@haqdaar/nest-kit';

export const CODE_TTL_MINUTES = 5;
export const MAX_CODE_TRIES = 5;
/** Sender name on the (mock) phone; rails-mock shows only this sender on the sign-up screen. */
export const SIGNUP_SENDER = 'HAQDAAR';

/** 6 digits from the OS random source (leading zeros kept). */
export function newCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Only this keyed hash is stored; it is bound to the phone so a code cannot be used for another number. */
export function hashCode(phone: string, code: string, keyHex: string): string {
  return lookupHash(`signup:${phone}:${code}`, keyHex);
}

export interface CodeRow {
  codeHash: string;
  expiresAt: Date;
  /** Tries so far, INCLUDING the one being judged. */
  attempts: number;
  usedAt: Date | null;
}

export type CodeVerdict = 'ok' | 'missing' | 'used' | 'expired' | 'locked' | 'wrong';

/** Order matters: a used, expired or locked code is dead even if the digits are right. */
export function checkCode(row: CodeRow | null, codeHash: string, now = new Date()): CodeVerdict {
  if (!row) return 'missing';
  if (row.usedAt) return 'used';
  if (row.expiresAt <= now) return 'expired';
  if (row.attempts > MAX_CODE_TRIES) return 'locked';
  return safeEqual(row.codeHash, codeHash) ? 'ok' : 'wrong';
}

export const signupSms = {
  code: (code: string) =>
    `Haqdaar: aap ka code ${code} hai. Yeh ${CODE_TTL_MINUTES} minute tak chalega. Yeh code kisi ko na batayein.\nآپ کا کوڈ ${code} ہے۔ یہ کوڈ کسی کو نہ بتائیں۔`,
  alreadyRegistered: () =>
    'Haqdaar: is number ka account pehle se bana hua hai. Apne PIN se login karein.\nاس نمبر کا اکاؤنٹ پہلے سے موجود ہے۔ اپنے پن سے لاگ اِن کریں۔',
};
