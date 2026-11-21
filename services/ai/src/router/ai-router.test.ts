import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AiRouter } from './ai-router';
import { MockProvider } from '../providers/mock.provider';
import { ProviderError, type AiProvider, type LlmRequest } from '../providers/types';

const req: LlmRequest = {
  task: 't',
  system: 's',
  messages: [{ role: 'user', content: 'hi' }],
  timeoutMs: 1000,
};

function fake(id: string, behaviour: 'ok' | 'fail' | 'unconfigured', calls: string[]): AiProvider {
  return {
    id,
    configured: behaviour !== 'unconfigured',
    isMock: false,
    async complete() {
      calls.push(id);
      if (behaviour === 'fail') throw new ProviderError(id, 'HTTP 429', 429, true);
      return { text: `from ${id}`, model: `${id}-model` };
    },
  };
}

test('dev profile uses groq first', async () => {
  const calls: string[] = [];
  const r = new AiRouter('dev', [
    fake('groq', 'ok', calls),
    fake('gemini', 'ok', calls),
    new MockProvider(),
  ]);
  const out = await r.complete(req);
  assert.equal(out.provider, 'groq');
  assert.equal(out.fallbackUsed, false);
  assert.deepEqual(calls, ['groq']);
});

test('demo profile uses the paid gemini key first, without touching code', async () => {
  const calls: string[] = [];
  const r = new AiRouter('demo', [
    fake('groq', 'ok', calls),
    fake('gemini-demo', 'ok', calls),
    new MockProvider(),
  ]);
  assert.equal((await r.complete(req)).provider, 'gemini-demo');
});

test('rate-limited provider falls back to the next one', async () => {
  const calls: string[] = [];
  const r = new AiRouter('dev', [
    fake('groq', 'fail', calls),
    fake('gemini', 'ok', calls),
    new MockProvider(),
  ]);
  const out = await r.complete(req);
  assert.equal(out.provider, 'gemini');
  assert.equal(out.fallbackUsed, true);
});

test('unconfigured providers are skipped; all down ends at the mock (never throws)', async () => {
  const calls: string[] = [];
  const r = new AiRouter('dev', [
    fake('groq', 'unconfigured', calls),
    fake('gemini', 'fail', calls),
    new MockProvider(),
  ]);
  const out = await r.complete(req);
  assert.equal(out.provider, 'mock');
  assert.equal(out.isMock, true);
  assert.deepEqual(calls, ['gemini']);
});

test('Kill AI sends everything to the mock immediately', async () => {
  const calls: string[] = [];
  const r = new AiRouter('demo', [fake('gemini-demo', 'ok', calls), new MockProvider()]);
  r.setKilled(true);
  const out = await r.complete(req);
  assert.equal(out.isMock, true);
  assert.deepEqual(calls, []);
});

test('circuit opens after repeated failures and the provider is skipped', async () => {
  const calls: string[] = [];
  const r = new AiRouter('dev', [
    fake('groq', 'fail', calls),
    fake('gemini', 'ok', calls),
    new MockProvider(),
  ]);
  for (let i = 0; i < 3; i++) await r.complete(req);
  calls.length = 0;
  const out = await r.complete(req);
  assert.equal(out.attempts[0]?.skipped, 'circuit_open');
  assert.deepEqual(calls, ['gemini']);
});
