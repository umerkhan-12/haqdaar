import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Field-level encryption for PII (CNIC, phone): AES-256-GCM.
 * Output format: v1.<iv b64>.<tag b64>.<ciphertext b64>
 * Key: 32 bytes, given as 64 hex chars (PII_ENC_KEY).
 */
export function encryptField(plain: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

export function decryptField(payload: string, keyHex: string): string {
  const [v, iv, tag, data] = payload.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported ciphertext');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(keyHex, 'hex'),
    Buffer.from(iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

/** Deterministic keyed hash for lookups on encrypted fields (find person by CNIC). */
export function lookupHash(value: string, keyHex: string): string {
  return createHmac('sha256', Buffer.from(keyHex, 'hex')).update(value.trim()).digest('hex');
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Opaque random token (refresh tokens, API keys). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** 42101-1234567-3 -> 42101-*****67-3 */
export function maskCnic(cnic: string): string {
  return cnic.replace(/^(\d{5})-(\d{5})(\d{2})-(\d)$/, '$1-*****$3-$4');
}
