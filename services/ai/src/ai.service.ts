import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { buildEvent, EventBus, HealthRegistry, type Principal } from '@haqdaar/nest-kit';
import { env } from './env';
import { AiRouter, PROFILES, type CallRecord, type ProfileName } from './router/ai-router';
import { GroqProvider } from './providers/groq.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { MockProvider } from './providers/mock.provider';
import { extractClaim } from './tasks/extract-claim';
import { scamCheck } from './tasks/scam-check';

/** Rolling in-memory stats for the evaluation dashboard (persisted via events to audit). */
interface Stats {
  calls: number;
  failures: number;
  fallbacks: number;
  mockAnswers: number;
  byProvider: Record<string, { calls: number; totalMs: number }>;
}

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  readonly router: AiRouter;
  private readonly stats: Stats = { calls: 0, failures: 0, fallbacks: 0, mockAnswers: 0, byProvider: {} };

  constructor(
    private readonly bus: EventBus,
    private readonly health: HealthRegistry,
  ) {
    this.router = new AiRouter(
      env.AI_PROFILE,
      [
        new GroqProvider(env.GROQ_API_KEY, env.GROQ_LLM_MODEL, env.GROQ_STT_MODEL),
        new GeminiProvider('gemini', env.GEMINI_API_KEY, env.GEMINI_MODEL),
        new GeminiProvider('gemini-demo', env.GEMINI_DEMO_API_KEY, env.GEMINI_MODEL),
        new MockProvider(),
      ],
      (r) => this.record(r),
    );
  }

  onModuleInit() {
    const s = this.router.status();
    const ready = s.llm.filter((p) => p.configured).map((p) => p.provider);
    this.logger.log(`AI_PROFILE=${s.profile} — LLM chain: ${ready.join(' → ') || 'none'} → mock`);
    if (env.AI_PROFILE === 'demo' && !env.GEMINI_DEMO_API_KEY) {
      this.logger.warn('AI_PROFILE=demo but GEMINI_DEMO_API_KEY is empty: falling back to Groq');
    }
    // Non-critical: the service stays up (and answers via the mock) even if every vendor is down.
    this.health.register('ai_providers', async () => this.router.status(), false);
  }

  status() {
    return { ...this.router.status(), stats: this.stats, profiles: PROFILES };
  }

  setProfile(profile: ProfileName, by: Principal) {
    this.router.setProfile(profile);
    this.logger.warn({ by, profile }, 'AI profile changed at runtime');
    return this.status();
  }

  async setKilled(killed: boolean, by: Principal) {
    this.router.setKilled(killed);
    this.logger.warn({ by, killed }, 'Kill AI switch changed');
    await this.bus
      .publish(buildEvent('ai.kill_switch.changed', { killed }, { source: 'ai', principal: by }))
      .catch((err) => this.logger.error({ err }, 'Could not publish kill switch event'));
    return this.status();
  }

  extractClaim(transcript: string) {
    return extractClaim(this.router, transcript);
  }

  scamCheck(text: string) {
    return scamCheck(this.router, text, env.SEAL_SECRET);
  }

  async transcribe(audio: Buffer, mimeType: string, language = 'ur') {
    const r = await this.router.transcribe({ audio, mimeType, language, timeoutMs: env.AI_TIMEOUT_MS });
    return {
      text: r.value.text,
      provider: r.provider,
      model: r.value.model,
      latencyMs: r.latencyMs,
      fallbackUsed: r.fallbackUsed,
      // Empty text from the mock = "I could not hear you" → UI falls back to icons / helper.
      understood: !r.isMock && r.value.text.length > 0,
    };
  }

  private record(r: CallRecord) {
    this.stats.calls += 1;
    if (!r.ok) this.stats.failures += 1;
    if (r.fallbackUsed) this.stats.fallbacks += 1;
    if (r.isMock) this.stats.mockAnswers += 1;
    const p = (this.stats.byProvider[r.provider] ??= { calls: 0, totalMs: 0 });
    p.calls += 1;
    p.totalMs += r.latencyMs;

    // Audit what left the system: only real vendor calls. Local mock answers send no data anywhere.
    if (r.isMock) return;
    void this.bus
      .publish(
        buildEvent(
          'ai.call.completed',
          {
            task: r.task,
            provider: r.provider,
            model: r.model,
            latencyMs: r.latencyMs,
            ok: r.ok,
            fallbackUsed: r.fallbackUsed,
          },
          { source: 'ai' },
        ),
      )
      .catch(() => undefined);
  }
}
