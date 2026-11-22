import { z } from 'zod';
import { BaseEnv, loadEnv, loadRootEnv, pem } from '@haqdaar/nest-kit';

loadRootEnv();

const Env = BaseEnv.extend({
  BUS_DATABASE_URL: z.string().url(),
  KNOWLEDGE_DATABASE_URL: z.string().url(),
  AI_PROFILE: z.enum(['dev', 'demo', 'offline']).default('dev'),
  KNOWLEDGE_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(20_000),
  KNOWLEDGE_RELEVANCE_THRESHOLD: z.coerce.number().min(-1).max(1).default(0.32),
  // Share of the question's words the best chunk must contain before the local path answers.
  KNOWLEDGE_LOCAL_COVERAGE: z.coerce.number().min(0).max(1).default(0.6),
  LOG_PRETTY: z.string().optional(),
});

const raw = loadEnv(Env);
export const env = { ...raw, JWT_PUBLIC_KEY: pem(raw.JWT_PUBLIC_KEY) };
