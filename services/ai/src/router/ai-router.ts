import { CircuitBreaker } from '@haqdaar/nest-kit';
import {
  ProviderError,
  type AiProvider,
  type LlmRequest,
  type SttRequest,
} from '../providers/types';

export type ProfileName = 'dev' | 'demo' | 'offline';

/** Provider order per profile. `mock` is always the last resort, so the system never crashes. */
export const PROFILES: Record<ProfileName, { llm: string[]; stt: string[]; description: string }> = {
  dev: {
    llm: ['groq', 'gemini'],
    stt: ['groq', 'gemini'],
    description: 'Build mode: free Groq first, free Gemini as fallback',
  },
  demo: {
    llm: ['gemini-demo', 'groq'],
    stt: ['groq', 'gemini-demo'],
    description: 'Judging day: paid Gemini first for text, Groq Whisper first for Urdu speech',
  },
  offline: {
    llm: [],
    stt: [],
    description: 'No external AI: deterministic mock, every uncertain case goes to a human',
  },
};

export interface Attempt {
  provider: string;
  ok: boolean;
  ms: number;
  error?: string;
  skipped?: 'not_configured' | 'circuit_open';
}

export interface RoutedResult<T> {
  value: T;
  provider: string;
  isMock: boolean;
  fallbackUsed: boolean;
  latencyMs: number;
  attempts: Attempt[];
}

export interface CallRecord {
  task: string;
  kind: 'llm' | 'stt';
  provider: string;
  model: string;
  ok: boolean;
  isMock: boolean;
  fallbackUsed: boolean;
  latencyMs: number;
}

/**
 * Routes each AI call through the active profile's provider list:
 * skip unconfigured providers, skip open circuits, fall through on retryable errors,
 * end at the mock. Kill AI forces the mock immediately.
 */
export class AiRouter {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly providers: Map<string, AiProvider>;
  private readonly mock: AiProvider;
  private killed = false;

  constructor(
    private profile: ProfileName,
    providers: AiProvider[],
    private readonly onCall: (r: CallRecord) => void = () => undefined,
  ) {
    this.providers = new Map(providers.map((p) => [p.id, p]));
    const mock = providers.find((p) => p.isMock);
    if (!mock) throw new Error('AiRouter needs a mock provider as last resort');
    this.mock = mock;
  }

  get activeProfile(): ProfileName {
    return this.profile;
  }

  get isKilled(): boolean {
    return this.killed;
  }

  setProfile(p: ProfileName): void {
    this.profile = p;
  }

  setKilled(k: boolean): void {
    this.killed = k;
  }

  status() {
    const chain = (ids: string[]) =>
      ids.map((id) => {
        const p = this.providers.get(id);
        return {
          provider: id,
          configured: p?.configured ?? false,
          circuit: this.breaker(id).status.state,
        };
      });
    const prof = PROFILES[this.profile];
    return {
      profile: this.profile,
      description: prof.description,
      killed: this.killed,
      llm: chain(prof.llm),
      stt: chain(prof.stt),
      lastResort: 'mock',
    };
  }

  complete(req: LlmRequest): Promise<RoutedResult<{ text: string; model: string }>> {
    return this.route('llm', req.task, PROFILES[this.profile].llm, (p) => {
      if (!p.complete) throw new ProviderError(p.id, 'no LLM support', undefined, true);
      return p.complete(req);
    });
  }

  transcribe(req: SttRequest, task = 'transcribe'): Promise<RoutedResult<{ text: string; model: string }>> {
    return this.route('stt', task, PROFILES[this.profile].stt, (p) => {
      if (!p.transcribe) throw new ProviderError(p.id, 'no STT support', undefined, true);
      return p.transcribe(req);
    });
  }

  private breaker(id: string): CircuitBreaker {
    let b = this.breakers.get(id);
    if (!b) {
      b = new CircuitBreaker(`ai:${id}`, { failureThreshold: 3, resetAfterMs: 30_000 });
      this.breakers.set(id, b);
    }
    return b;
  }

  private async route<T extends { model: string }>(
    kind: 'llm' | 'stt',
    task: string,
    order: string[],
    call: (p: AiProvider) => Promise<T>,
  ): Promise<RoutedResult<T>> {
    const started = Date.now();
    const attempts: Attempt[] = [];
    const chain = this.killed ? [] : order;

    for (const id of chain) {
      const p = this.providers.get(id);
      if (!p || !p.configured) {
        attempts.push({ provider: id, ok: false, ms: 0, skipped: 'not_configured' });
        continue;
      }
      const b = this.breaker(id);
      if (!b.canRequest()) {
        attempts.push({ provider: id, ok: false, ms: 0, skipped: 'circuit_open' });
        continue;
      }
      const t = Date.now();
      try {
        const value = await b.exec(() => call(p));
        attempts.push({ provider: id, ok: true, ms: Date.now() - t });
        return this.done(kind, task, value, p, attempts, started);
      } catch (e) {
        attempts.push({ provider: id, ok: false, ms: Date.now() - t, error: (e as Error).message.slice(0, 200) });
        // Non-retryable (our request is wrong): another vendor won't fix it, but the mock still answers safely.
        if (e instanceof ProviderError && !e.retryable) break;
      }
    }

    const value = await call(this.mock);
    attempts.push({ provider: this.mock.id, ok: true, ms: 0 });
    return this.done(kind, task, value, this.mock, attempts, started);
  }

  private done<T extends { model: string }>(
    kind: 'llm' | 'stt',
    task: string,
    value: T,
    p: AiProvider,
    attempts: Attempt[],
    started: number,
  ): RoutedResult<T> {
    const firstReal = attempts.find((a) => !a.skipped);
    const fallbackUsed = !!firstReal && firstReal.provider !== p.id;
    const latencyMs = Date.now() - started;
    this.onCall({
      task,
      kind,
      provider: p.id,
      model: value.model,
      ok: !p.isMock,
      isMock: p.isMock,
      fallbackUsed: fallbackUsed || p.isMock,
      latencyMs,
    });
    return { value, provider: p.id, isMock: p.isMock, fallbackUsed: fallbackUsed || p.isMock, latencyMs, attempts };
  }
}
