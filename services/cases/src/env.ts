import { z } from 'zod';
import { BaseEnv, loadEnv, loadRootEnv, pem } from '@haqdaar/nest-kit';

loadRootEnv();

const Env = BaseEnv.extend({
  CASES_DATABASE_URL: z.string().url(),
  BUS_DATABASE_URL: z.string().url(),
  PII_ENC_KEY: z.string().regex(/^[0-9a-f]{64}$/),
  PII_HASH_KEY: z.string().regex(/^[0-9a-f]{64}$/),
  /** Above this amount a human must approve, whatever the confidence. */
  AUTO_APPROVE_AMOUNT_CAP_PKR: z.coerce.number().int().positive().default(15_000),
  LOG_PRETTY: z.string().optional(),
});

const raw = loadEnv(Env);

export const env = { ...raw, JWT_PUBLIC_KEY: pem(raw.JWT_PUBLIC_KEY) };
