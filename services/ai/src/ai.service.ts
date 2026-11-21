import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { buildEvent, EventBus, HealthRegistry, type Principal } from '@haqdaar/nest-kit';
import { env } from './env';
import { edgeSynthesizer, Speech, SpeechUnavailableError, type SpeechLang } from './speech/speech';
import { AiRouter, PROFILES, type CallRecord, type ProfileName } from './router/ai-router';
import { GroqProvider } from './providers/groq.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { MockProvider } from './providers/mock.provider';
import { extractClaim } from './tasks/extract-claim';
import { scamCheck } from './tasks/scam-check';
import { callerContext } from './caller-context';
import { documentCheck, UnsupportedImageError } from './vision/document-check';
import { OcrEngine } from './vision/readers';

/** Rolling in-memory stats for the evaluation dashboard (persisted via events to audit). */
interface Stats {
  calls: number;
  failures: number;
  fallbacks: number;
  mockAnswers: number;
  byProvider: Record<string, { calls: number; totalMs: number }>;
}

@Injectable()
export class AiService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiService.name);
  readonly router: AiRouter;
  private readonly ocr = new OcrEngine(env.TESSDATA_DIR);
  private readonly speech = new Speech(
    env.TTS_CACHE_DIR ?? join(tmpdir(), 'haqdaar-tts'),
    edgeSynthesizer,
    env.TTS_TIMEOUT_MS,
  );
  private readonly stats: Stats = {
    calls: 0,
    failures: 0,
    fallbacks: 0,
    mockAnswers: 0,
    byProvider: {},
  };

  constructor(
    private readonly bus: EventBus,
    private readonly health: HealthRegistry,
  ) {
    this.router = new AiRouter(
      env.AI_PROFILE,
      [
        new GroqProvider(env.GROQ_API_KEY, env.GROQ_LLM_MODEL, env.GROQ_STT_MODEL),
        new GeminiProvider('gemini', env.GEMINI_API_KEY, env.GEMINI_MODEL, env.GEMINI_BUDGET_USD),
        new GeminiProvider(
          'gemini-demo',
          env.GEMINI_DEMO_API_KEY,
          env.GEMINI_MODEL,
          env.GEMINI_BUDGET_USD,
        ),
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
    // Load the OCR model off the request path; the first boot downloads it once.
    void this.ocr.warm();
  }

  onModuleDestroy() {
    return this.ocr.terminate();
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

  async transcribe(audio: Buffer, mimeType: string, language?: string) {
    const r = await this.router.transcribe({
      audio,
      mimeType,
      language,
      timeoutMs: env.AI_TIMEOUT_MS,
    });
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

  /**
   * Text → spoken Urdu or English (mp3). Speech only reads out text the system already decided to show,
   * so Kill AI does not silence it; only the `offline` profile does (no network by definition).
   * Unavailable → 503 with `fallback: 'browser'`: the phone then uses its own built-in voice.
   */
  async speak(text: string, lang: SpeechLang) {
    const unavailable = () =>
      new ServiceUnavailableException({
        message: 'Speech is unavailable',
        details: { code: 'SPEECH_UNAVAILABLE', fallback: 'browser' },
      });
    if (this.router.activeProfile === 'offline') throw unavailable();
    try {
      return await this.speech.speak(text, lang);
    } catch (err) {
      if (!(err instanceof SpeechUnavailableError)) throw err;
      this.logger.warn(
        { err: err.message },
        'Speech synthesis failed; phone falls back to its own voice',
      );
      throw unavailable();
    }
  }

  /** Local only: the image never reaches an external model. Kill AI → every document to a human. */
  async documentCheck(image: Buffer, typedCnic?: string) {
    try {
      return await documentCheck(image, typedCnic, {
        ocr: (png) => this.ocr.readLines(png, env.AI_TIMEOUT_MS),
        killed: this.router.isKilled,
      });
    } catch (err) {
      if (err instanceof UnsupportedImageError) throw new BadRequestException(err.message);
      throw err;
    }
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
          { source: 'ai', principal: callerContext.getStore() },
        ),
      )
      .catch(() => undefined);
  }
}
