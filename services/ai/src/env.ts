import { z } from 'zod';
import { BaseEnv, loadEnv, loadRootEnv, pem } from '@haqdaar/nest-kit';

loadRootEnv();

export const AiProfile = z.enum(['dev', 'demo', 'offline']);
export type AiProfile = z.infer<typeof AiProfile>;

const Env = BaseEnv.extend({
  BUS_DATABASE_URL: z.string().url(),
  SEAL_SECRET: z.string().min(32),
  AI_PROFILE: AiProfile.default('dev'),
  GROQ_API_KEY: z.string().optional(),
  GROQ_LLM_MODEL: z.string().default('llama-3.3-70b-versatile'),
  GROQ_STT_MODEL: z.string().default('whisper-large-v3'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_DEMO_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(20_000),
  LOG_PRETTY: z.string().optional(),
});

const raw = loadEnv(Env);
const blank = (v?: string) => (v && v.trim() ? v.trim() : undefined);

export const env = {
  ...raw,
  JWT_PUBLIC_KEY: pem(raw.JWT_PUBLIC_KEY),
  GROQ_API_KEY: blank(raw.GROQ_API_KEY),
  GEMINI_API_KEY: blank(raw.GEMINI_API_KEY),
  GEMINI_DEMO_API_KEY: blank(raw.GEMINI_DEMO_API_KEY),
};
