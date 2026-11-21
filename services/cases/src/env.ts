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
  ANOMALY_SHARED_PAYOUT_PEOPLE: z.coerce.number().int().min(2).max(100).default(2),
  ANOMALY_HELPER_CLAIMS_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(5),
  ANOMALY_HOUSEHOLD_PATTERN_PEOPLE: z.coerce.number().int().min(2).max(100).default(5),
  ANOMALY_IDENTITY_CORROBORATION_DETAILS: z.coerce.number().int().min(1).max(3).default(2),
  LOG_PRETTY: z.string().optional(),
});

const raw = loadEnv(Env);

export const env = { ...raw, JWT_PUBLIC_KEY: pem(raw.JWT_PUBLIC_KEY) };
