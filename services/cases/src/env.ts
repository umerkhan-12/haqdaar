import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BaseEnv, loadEnv, loadRootEnv, pem } from '@haqdaar/nest-kit';

loadRootEnv();

/** Same derivation as identity: 32-byte hex, or any high-entropy secret hashed down to one. */
const PiiKey = z
  .string()
  .min(32)
  .transform((v) => (/^[0-9a-f]{64}$/.test(v) ? v : createHash('sha256').update(v).digest('hex')));

const Env = BaseEnv.extend({
  CASES_DATABASE_URL: z.string().url(),
  BUS_DATABASE_URL: z.string().url(),
  PII_ENC_KEY: PiiKey,
  PII_HASH_KEY: PiiKey,
  /** Above this amount a human must approve, whatever the confidence. */
  AUTO_APPROVE_AMOUNT_CAP_PKR: z.coerce.number().int().positive().default(15_000),
  LOG_PRETTY: z.string().optional(),
});

const raw = loadEnv(Env);

export const env = { ...raw, JWT_PUBLIC_KEY: pem(raw.JWT_PUBLIC_KEY) };
