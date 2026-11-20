import { z } from 'zod';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Load the monorepo root `.env` (walks up from cwd). Never overrides variables that are
 * already set, so real environment (Render, CI) always wins.
 */
export function loadRootEnv(start = process.cwd()): string | null {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const file = join(dir, '.env');
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return file;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Env vars every service understands. Services extend this with their own. */
export const BaseEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PORT: z.coerce.number().int().optional(),
  /** RS256 public key (PEM, `\n` escaped allowed) used to verify user access tokens. */
  JWT_PUBLIC_KEY: z.string().min(100),
  /** Shared secret for short-lived service-to-service tokens. */
  INTERNAL_SECRET: z.string().min(32),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
});
export type BaseEnv = z.infer<typeof BaseEnv>;

/** Env vars for services that own a database schema and use the event bus. */
export const DbEnv = z.object({
  DATABASE_URL: z.string().url(),
  /** Connection used by pg-boss (shared `pgboss` schema). Defaults to DATABASE_URL without `schema`. */
  BUS_DATABASE_URL: z.string().url().optional(),
});

/**
 * Validate process.env against a schema and fail fast with a readable message.
 * A service must never start half-configured.
 */
export function loadEnv<T extends z.ZodTypeAny>(schema: T, env = process.env): z.infer<T> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    // eslint-disable-next-line no-console
    console.error(`\nInvalid environment configuration:\n${lines.join('\n')}\n`);
    process.exit(1);
  }
  return parsed.data;
}

/** PEM keys are often stored in env with literal "\n". */
export function pem(value: string): string {
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

/** Remove Prisma's `schema` query param so plain `pg` / pg-boss can use the URL. */
export function stripSchemaParam(url: string): { url: string; schema: string | null } {
  const u = new URL(url);
  const schema = u.searchParams.get('schema');
  u.searchParams.delete('schema');
  return { url: u.toString(), schema };
}
