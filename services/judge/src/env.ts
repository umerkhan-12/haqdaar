import { z } from 'zod';
import { BaseEnv, loadEnv, loadRootEnv, pem } from '@haqdaar/nest-kit';

loadRootEnv();

const Env = BaseEnv.extend({
  BUS_DATABASE_URL: z.string().url(),
  /** Judge Mode signs a genuine program message to show the Seal working. */
  SEAL_SECRET: z.string().min(32),
  /** Password of the seeded demo accounts. Demo environments only. */
  DEMO_PASSWORD: z.string().default('demo1234'),
  LOG_PRETTY: z.string().optional(),
});

const raw = loadEnv(Env);

export const env = { ...raw, JWT_PUBLIC_KEY: pem(raw.JWT_PUBLIC_KEY) };
