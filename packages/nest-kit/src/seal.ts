import { createHmac } from 'node:crypto';
import { safeEqual } from './crypto';

/**
 * Haqdaar Seal — proves a program message is genuine (challenge 08).
 * Every real Sahara message ends with:  "Haqdaar code: HQ1-20261231-AB12CD34EF"
 *   HQ1       = seal version
 *   20261231  = expiry date (YYYYMMDD)
 *   10 chars  = HMAC-SHA256(secret, normalizedBody|expiry), base32, truncated
 * Changing one character of the message, or copying the code onto another message, breaks it.
 */
const SEAL_RE = /haqdaar\s*code\s*:?\s*(HQ1-(\d{8})-([A-Z2-7]{10}))/i;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

/** Whitespace, case and the seal line itself do not count, so forwarding does not break it. */
export function normalizeSealBody(text: string): string {
  return text.replace(SEAL_RE, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function signature(body: string, expiry: string, secret: string): string {
  const mac = createHmac('sha256', secret)
    .update(`${normalizeSealBody(body)}|${expiry}`)
    .digest();
  return base32(mac).slice(0, 10);
}

export function sealMessage(body: string, secret: string, expiry: Date): string {
  const exp = expiry.toISOString().slice(0, 10).replace(/-/g, '');
  return `${body.trim()}\nHaqdaar code: HQ1-${exp}-${signature(body, exp, secret)}`;
}

export type SealResult =
  | { present: false }
  | { present: true; valid: true; expiry: string }
  | { present: true; valid: false; reason: 'bad_signature' | 'expired'; expiry: string };

export function verifySeal(message: string, secret: string, now = new Date()): SealResult {
  const m = message.match(SEAL_RE);
  if (!m) return { present: false };
  const expiry = m[2]!;
  const sig = m[3]!.toUpperCase();
  if (!safeEqual(sig, signature(message, expiry, secret))) {
    return { present: true, valid: false, reason: 'bad_signature', expiry };
  }
  const today = now.toISOString().slice(0, 10).replace(/-/g, '');
  if (today > expiry) return { present: true, valid: false, reason: 'expired', expiry };
  return { present: true, valid: true, expiry };
}
