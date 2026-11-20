import { z } from 'zod';
import { BaseEnv, loadEnv, loadRootEnv, pem } from '@haqdaar/nest-kit';

loadRootEnv();

const Env = BaseEnv.extend({
  IDENTITY_DATABASE_URL: z.string().url(),
  BUS_DATABASE_URL: z.string().url(),
  JWT_PRIVATE_KEY: z.string().min(100),
  PII_ENC_KEY: z.string().regex(/^[0-9a-f]{64}$/),
  PII_HASH_KEY: z.string().regex(/^[0-9a-f]{64}$/),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(7),
  LOG_PRETTY: z.string().optional(),
});

const raw = loadEnv(Env);

export const env = {
  ...raw,
  JWT_PRIVATE_KEY: pem(raw.JWT_PRIVATE_KEY),
  JWT_PUBLIC_KEY: pem(raw.JWT_PUBLIC_KEY),
};
