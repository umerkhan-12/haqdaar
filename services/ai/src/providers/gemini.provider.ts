import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readError,
  type AiProvider,
  type LlmRequest,
  type LlmResponse,
  type SttRequest,
  type SttResponse,
} from './types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** USD per million tokens, set above Gemini Flash-Lite list prices so the spending cap trips early, never late. */
const USD_PER_M_INPUT = 1;
const USD_PER_M_OUTPUT = 4;

/** Spend shared by every Gemini instance, kept on disk so a restart does not reset the cap. */
class SpendLedger {
  private readonly file = join(tmpdir(), 'haqdaar-gemini-spend.json');
  private usd: number;

  constructor() {
    try {
      this.usd = (JSON.parse(readFileSync(this.file, 'utf8')) as { usd: number }).usd;
    } catch {
      this.usd = 0;
    }
  }

  get spentUsd() {
    return this.usd;
  }

  add(inputTokens = 0, outputTokens = 0) {
    this.usd += (inputTokens * USD_PER_M_INPUT + outputTokens * USD_PER_M_OUTPUT) / 1_000_000;
    writeFileSync(this.file, JSON.stringify({ usd: this.usd }));
  }
}

const ledger = new SpendLedger();

/**
 * Gemini over REST. Two instances exist: `gemini` (free key, dev fallback) and
 * `gemini-demo` (paid key, used only when AI_PROFILE=demo). Both stop at the shared spending cap.
 */
export class GeminiProvider implements AiProvider {
  readonly isMock = false;

  constructor(
    readonly id: string,
    private readonly apiKey: string | undefined,
    private readonly model: string,
    private readonly budgetUsd: number,
  ) {}

  /** Over budget counts as not configured: the router skips it and falls back to Groq. */
  get configured() {
    return !!this.apiKey && ledger.spentUsd < this.budgetUsd;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    return this.generate(
      req.system,
      req.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      req.json ?? false,
      req.temperature ?? 0.1,
      req.maxTokens ?? 800,
      req.timeoutMs,
    );
  }

  async transcribe(req: SttRequest): Promise<SttResponse> {
    // Transcribe, never answer: without this the model sometimes replies to the speaker instead.
    const r = await this.generate(
      'You transcribe voice recordings word for word. The speaker is a person in Pakistan asking a relief program for help, ' +
        'usually in Urdu (often with a Sindhi or Punjabi accent), sometimes in English or a mix. ' +
        'Write Urdu in Urdu script and English words in English. Write every number as Western digits (0-9), ' +
        'including identity card and phone numbers spoken as words. Do not translate, summarise or answer, and add no commentary. ' +
        'Output only the words spoken. If nothing is audible, output nothing.',
      [
        {
          role: 'user',
          parts: [
            {
              inline_data: {
                mime_type: req.mimeType.split(';')[0],
                data: req.audio.toString('base64'),
              },
            },
            { text: 'Transcribe this recording.' },
          ],
        },
      ],
      false,
      0,
      600,
      req.timeoutMs,
    );
    return { text: r.text.trim(), model: r.model };
  }

  private async generate(
    system: string,
    contents: unknown[],
    json: boolean,
    temperature: number,
    maxOutputTokens: number,
    timeoutMs: number,
  ): Promise<LlmResponse> {
    const res = await fetch(`${BASE}/${this.model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': this.apiKey!, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: {
          temperature,
          maxOutputTokens,
          responseMimeType: json ? 'application/json' : 'text/plain',
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) await readError(this.id, res);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      modelVersion?: string;
    };
    ledger.add(data.usageMetadata?.promptTokenCount, data.usageMetadata?.candidatesTokenCount);
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    return {
      text,
      model: data.modelVersion ?? this.model,
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
    };
  }
}
