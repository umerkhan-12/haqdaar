export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  /** Task name for logs, metrics and prompt versioning, e.g. `extract_claim@v1`. */
  task: string;
  system: string;
  messages: ChatMessage[];
  /** Ask the model for a JSON object (we still validate it). */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs: number;
}

export interface LlmResponse {
  text: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface SttRequest {
  audio: Buffer;
  mimeType: string;
  /** ISO 639-1, e.g. `ur` */
  /** ISO 639-1 to force a language; omit to auto-detect (Urdu and English both work). */
  language?: string;
  timeoutMs: number;
}

export interface SttResponse {
  text: string;
  model: string;
}

/** Every AI vendor sits behind this interface, so the profile switch never touches task code. */
export interface AiProvider {
  /** Stable id used in profiles and metrics, e.g. `groq`, `gemini-demo`, `mock`. */
  readonly id: string;
  /** False when the provider has no API key configured (it is skipped, not failed). */
  readonly configured: boolean;
  /** True for the deterministic mock: its output must never auto-approve anything. */
  readonly isMock: boolean;
  complete?(req: LlmRequest): Promise<LlmResponse>;
  transcribe?(req: SttRequest): Promise<SttResponse>;
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status?: number,
    /** 429 / 5xx / timeout: try the next provider. 400-type errors are our bug. */
    public readonly retryable = true,
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'ProviderError';
  }
}

export async function readError(provider: string, res: Response): Promise<never> {
  const body = await res.text().catch(() => '');
  // Only a malformed request (400/413/415/422) is our fault. Auth, billing (401/402/403), a retired model (404),
  // rate limits and outages are this vendor's problem, so the next vendor in the chain gets its turn.
  const retryable = ![400, 413, 415, 422].includes(res.status);
  throw new ProviderError(
    provider,
    `HTTP ${res.status}: ${body.slice(0, 300)}`,
    res.status,
    retryable,
  );
}
