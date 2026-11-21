import {
  readError,
  type AiProvider,
  type EmbeddingRequest,
  type EmbeddingResponse,
  type LlmRequest,
  type LlmResponse,
  type SttRequest,
  type SttResponse,
} from './types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Gemini over REST. Two instances exist: `gemini` (free key, dev fallback) and
 * `gemini-demo` (paid key, used only when AI_PROFILE=demo).
 */
export class GeminiProvider implements AiProvider {
  readonly isMock = false;

  constructor(
    readonly id: string,
    private readonly apiKey: string | undefined,
    private readonly model: string,
  ) {}

  get configured() {
    return !!this.apiKey;
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
    const r = await this.generate(
      'You transcribe audio verbatim. Output only the transcript in the original language and script. No translation, no notes.',
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
            { text: `Transcribe this ${req.language === 'ur' ? 'Urdu' : req.language} audio.` },
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

  async embed(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    const res = await fetch(`${BASE}/${req.model}:embedContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': this.apiKey!, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: `models/${req.model}`,
        content: { parts: [{ text: req.text }] },
        taskType: req.taskType,
      }),
      signal: AbortSignal.timeout(req.timeoutMs),
    });
    if (!res.ok) await readError(this.id, res);
    const data = (await res.json()) as { embedding?: { values?: number[] } };
    const embedding = data.embedding?.values;
    if (!embedding?.length || embedding.some((n) => !Number.isFinite(n))) {
      throw new Error('Gemini returned an invalid embedding');
    }
    return { embedding, model: req.model };
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
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    return {
      text,
      model: data.modelVersion ?? this.model,
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
    };
  }
}
