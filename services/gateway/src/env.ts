import { z } from 'zod';
import { BaseEnv, loadEnv, loadRootEnv, pem } from '@haqdaar/nest-kit';

loadRootEnv();

const Env = BaseEnv.extend({
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).default(1200),
  LOG_PRETTY: z.string().optional(),
});

const raw = loadEnv(Env);

export const env = {
  ...raw,
  JWT_PUBLIC_KEY: pem(raw.JWT_PUBLIC_KEY),
  corsOrigins: raw.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
};
