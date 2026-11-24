import {
  readError,
  type AiProvider,
  type LlmRequest,
  type LlmResponse,
  type SttRequest,
  type SttResponse,
} from './types';

const BASE = 'https://api.groq.com/openai/v1';

/**
 * Vocabulary hint for Whisper: the program's words, districts and the CNIC format. Measured on Urdu and
 * English test recordings, it fixes place names (Thatta, not Thada) and returns spoken numbers as digits.
 */
const WHISPER_HINT =
  'Assalam o alaikum. Mera naam hai. Main Thatta, Sujawal, Badin, Tharparkar, Karachi se hoon. ' +
  'Ghar mein 5 log hain. Bewa. Madad. Shanakhti card number 42101-1234567-1. Phone 0300-1234567.';

/** Groq: Llama for text, Whisper large-v3 for Urdu speech. OpenAI-compatible REST, no SDK needed. */
export class GroqProvider implements AiProvider {
  readonly id = 'groq';
  readonly isMock = false;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly llmModel: string,
    private readonly sttModel: string,
  ) {}

  get configured() {
    return !!this.apiKey;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.llmModel,
        temperature: req.temperature ?? 0.1,
        max_tokens: req.maxTokens ?? 800,
        response_format: req.json ? { type: 'json_object' } : undefined,
        messages: [{ role: 'system', content: req.system }, ...req.messages],
      }),
      signal: AbortSignal.timeout(req.timeoutMs),
    });
    if (!res.ok) await readError(this.id, res);
    const data = (await res.json()) as {
      model: string;
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    return {
      text: data.choices[0]?.message.content ?? '',
      model: data.model,
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
    };
  }

  async transcribe(req: SttRequest): Promise<SttResponse> {
    const form = new FormData();
    // Whisper reads the format from the file name: "audio/x-wav" must become .wav, not .x-wav.
    const sub = req.mimeType.split('/')[1]?.split(';')[0]?.trim().toLowerCase() ?? 'webm';
    const ext =
      ({ 'x-wav': 'wav', wave: 'wav', mpeg: 'mp3', 'x-m4a': 'm4a', mp4: 'm4a', 'x-flac': 'flac' } as Record<string, string>)[sub] ??
      sub;
    form.append(
      'file',
      new Blob([new Uint8Array(req.audio)], { type: req.mimeType }),
      `audio.${ext}`,
    );
    form.append('model', this.sttModel);
    if (req.language) form.append('language', req.language);
    form.append('prompt', WHISPER_HINT);
    form.append('temperature', '0');
    form.append('response_format', 'json');
    const res = await fetch(`${BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(req.timeoutMs),
    });
    if (!res.ok) await readError(this.id, res);
    const data = (await res.json()) as { text: string };
    return { text: data.text.trim(), model: this.sttModel };
  }
}
