import type { z, ZodTypeAny } from 'zod';
import { sha256 } from '@haqdaar/nest-kit';
import type { AiRouter } from '../router/ai-router';
import type { LlmRequest } from '../providers/types';

export interface AiMeta {
  task: string;
  provider: string;
  latencyMs: number;
  fallbackUsed: boolean;
  cached: boolean;
  repaired: boolean;
  model?: string;
  calls?: {
    provider: string;
    model: string;
    latencyMs: number;
    fallbackUsed: boolean;
    inputTokens?: number;
    outputTokens?: number;
  }[];
}

export type StructuredResult<T> =
  | { ok: true; data: T; meta: AiMeta }
  | { ok: false; reason: 'ai_off' | 'invalid_output'; meta: AiMeta };

/** Small TTL cache: same input → same answer, no second AI call (speed + consistency). */
export class TtlCache<V> {
  private readonly map = new Map<string, { v: V; exp: number }>();
  constructor(
    private readonly max = 500,
    private readonly ttlMs = 60 * 60_000,
  ) {}
  get(k: string): V | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (e.exp < Date.now()) {
      this.map.delete(k);
      return undefined;
    }
    return e.v;
  }
  set(k: string, v: V): void {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    this.map.set(k, { v, exp: Date.now() + this.ttlMs });
  }
  clear(): void { this.map.clear(); }
}

const cache = new TtlCache<unknown>();

/** Evaluation uses a cold pass followed by a cached pass in the same process. */
export function clearStructuredCache() {
  cache.clear();
}

/**
 * Ask for JSON, validate with Zod, repair once with the validation error, otherwise give up.
 * The caller treats `ok: false` as "not sure" → human review. Invalid output is never trusted.
 */
export async function structured<S extends ZodTypeAny>(
  router: AiRouter,
  schema: S,
  req: Omit<LlmRequest, 'json'>,
): Promise<StructuredResult<z.infer<S>>> {
  const key = sha256(JSON.stringify([router.activeProfile, req.task, req.system, req.messages]));
  // Never let a prior live response bypass Kill AI. Profile is also part of the cache key.
  const hit = router.isKilled ? undefined : cache.get(key);
  const base = { task: req.task, latencyMs: 0, fallbackUsed: false, repaired: false };
  if (hit !== undefined) {
    return { ok: true, data: hit as z.infer<S>, meta: { ...base, provider: 'cache', cached: true, calls: [] } };
  }

  const first = await router.complete({ ...req, json: true });
  const meta: AiMeta = {
    ...base,
    provider: first.provider,
    model: first.value.model,
    latencyMs: first.latencyMs,
    fallbackUsed: first.fallbackUsed,
    cached: false,
    calls: [{
      provider: first.provider,
      model: first.value.model,
      latencyMs: first.latencyMs,
      fallbackUsed: first.fallbackUsed,
      inputTokens: first.value.inputTokens,
      outputTokens: first.value.outputTokens,
    }],
  };
  if (first.isMock) return { ok: false, reason: 'ai_off', meta };

  let parsed = tryParse(schema, first.value.text);
  if (!parsed.ok) {
    const second = await router.complete({
      ...req,
      json: true,
      messages: [
        ...req.messages,
        { role: 'assistant', content: first.value.text.slice(0, 2000) },
        {
          role: 'user',
          content: `Your JSON was invalid: ${parsed.error}. Reply again with ONLY a valid JSON object matching the schema.`,
        },
      ],
    });
    meta.latencyMs += second.latencyMs;
    meta.provider = second.provider;
    meta.model = second.value.model;
    meta.fallbackUsed ||= second.fallbackUsed;
    meta.calls!.push({
      provider: second.provider,
      model: second.value.model,
      latencyMs: second.latencyMs,
      fallbackUsed: second.fallbackUsed,
      inputTokens: second.value.inputTokens,
      outputTokens: second.value.outputTokens,
    });
    meta.repaired = true;
    if (second.isMock) return { ok: false, reason: 'ai_off', meta };
    parsed = tryParse(schema, second.value.text);
  }
  if (!parsed.ok) return { ok: false, reason: 'invalid_output', meta };

  if (!router.isKilled) cache.set(key, parsed.data);
  return { ok: true, data: parsed.data, meta };
}

function tryParse<S extends ZodTypeAny>(
  schema: S,
  text: string,
): { ok: true; data: z.infer<S> } | { ok: false; error: string } {
  try {
    const json = JSON.parse(extractJson(text));
    const r = schema.safeParse(json);
    if (r.success) return { ok: true, data: r.data };
    return {
      ok: false,
      error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 400),
    };
  } catch (e) {
    return { ok: false, error: `not JSON (${(e as Error).message})` };
  }
}

/** Models sometimes wrap JSON in ``` fences. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1]!;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}
