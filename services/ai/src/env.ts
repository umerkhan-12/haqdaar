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
  GROQ_LLM_MODEL: z.string().default('openai/gpt-oss-120b'),
  GROQ_STT_MODEL: z.string().default('whisper-large-v3'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_DEMO_API_KEY: z.string().optional(),
  KNOWLEDGE_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),
  /** Hard cap on total Gemini spend (USD) across restarts; past it Gemini is skipped. */
  GEMINI_BUDGET_USD: z.coerce.number().min(0).default(2),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(20_000),
  /** Where synthesised speech is kept (one mp3 per sentence). Defaults to the OS temp dir. */
  TTS_CACHE_DIR: z.string().optional(),
  TTS_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10_000),
  /** Cache for the Tesseract English model (downloaded once). Defaults to the OS temp dir. */
  TESSDATA_DIR: z.string().optional(),
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
  KNOWLEDGE_EMBEDDING_MODEL: raw.KNOWLEDGE_EMBEDDING_MODEL,
  TESSDATA_DIR: blank(raw.TESSDATA_DIR),
  TTS_CACHE_DIR: blank(raw.TTS_CACHE_DIR),
};
