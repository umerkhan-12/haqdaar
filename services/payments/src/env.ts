import { z } from 'zod';
import { BaseEnv, loadEnv, loadRootEnv, pem } from '@haqdaar/nest-kit';

loadRootEnv();

const Env = BaseEnv.extend({
  PAYMENTS_DATABASE_URL: z.string().url(),
  BUS_DATABASE_URL: z.string().url(),
  WEBHOOK_SIGNING_SECRET: z.string().min(32),
  /** Signs the Haq Receipt SMS so the citizen can prove it is genuine. */
  SEAL_SECRET: z.string().min(32),
  /** Payouts above this need a human checker (four-eyes). */
  MAKER_CHECKER_LIMIT_PKR: z.coerce.number().int().positive().default(20_000),
  PROGRAM_DEBTOR_IBAN: z.string().default('PK00SAHA0000000000000001'),
  PROGRAM_DEBTOR_NAME: z.string().default('SAHARA RELIEF PROGRAM'),
  /** Shorter than the provider's slow path, so a slow transfer becomes UNKNOWN, never a blind retry. */
  RAAST_TIMEOUT_MS: z.coerce.number().int().min(500).default(3000),
  LOG_PRETTY: z.string().optional(),
});

const raw = loadEnv(Env);

export const env = { ...raw, JWT_PUBLIC_KEY: pem(raw.JWT_PUBLIC_KEY) };
