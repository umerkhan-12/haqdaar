import type { AiProvider, LlmRequest, LlmResponse, SttResponse } from './types';

/**
 * Deterministic offline provider: used by AI_PROFILE=offline, tests, CI and Kill AI.
 * It returns "I don't know" shaped answers so every downstream path routes to a human.
 */
export class MockProvider implements AiProvider {
  readonly id = 'mock';
  readonly configured = true;
  readonly isMock = true;

  async complete(req: LlmRequest): Promise<LlmResponse> {
    if (!req.json) return { text: 'AI is switched off. A person will review this.', model: 'mock' };
    return { text: JSON.stringify({ __mock: true }), model: 'mock' };
  }

  async transcribe(): Promise<SttResponse> {
    return { text: '', model: 'mock' };
  }
}
