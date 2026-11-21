import { z } from 'zod';
import { BaseEnv, loadEnv, loadRootEnv, pem } from '@haqdaar/nest-kit';

loadRootEnv();

const raw = loadEnv(BaseEnv.extend({ LOG_PRETTY: z.string().optional() }));

export const env = { ...raw, JWT_PUBLIC_KEY: pem(raw.JWT_PUBLIC_KEY) };
