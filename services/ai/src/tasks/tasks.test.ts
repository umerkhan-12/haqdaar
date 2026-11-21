import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealMessage } from '@haqdaar/nest-kit';
import { AiRouter } from '../router/ai-router';
import { MockProvider } from '../providers/mock.provider';
import type { AiProvider } from '../providers/types';
import { redactPii } from './pii';
import { scamCheck } from './scam-check';
import { extractClaim } from './extract-claim';

const SECRET = 'x'.repeat(40);
const offline = () => new AiRouter('offline', [new MockProvider()]);

function scripted(text: string): AiProvider {
  return {
    id: 'groq',
    configured: true,
    isMock: false,
    async complete() {
      return { text, model: 'scripted' };
    },
  };
}

test('PII is removed before the prompt (Urdu digits too)', () => {
  const r = redactPii('Mera CNIC ۴۲۱۰۱-۱۲۳۴۵۶۷-۳ hai aur number 0300 1234567');
  assert.equal(r.text, 'Mera CNIC [CNIC_1] hai aur number [PHONE_1]');
  assert.deepEqual(r.cnics, ['42101-1234567-3']);
  assert.deepEqual(r.phones, ['03001234567']);
});

test('valid seal → GENUINE without calling AI', async () => {
  const msg = sealMessage(
    'Sahara: Rs 12,000 sent to your account.',
    SECRET,
    new Date('2030-01-01'),
  );
  const r = await scamCheck(offline(), msg, SECRET);
  assert.equal(r.verdict, 'GENUINE');
  assert.equal(r.meta, null);
});

test('fee + PIN request → SCAM even with AI off (Kill AI)', async () => {
  const r = await scamCheck(
    offline(),
    'BISP: apna PIN bhejein aur Rs 500 fee jama karayen',
    SECRET,
  );
  assert.equal(r.verdict, 'SCAM');
  assert.ok(r.redFlags.includes('asks_secret'));
  assert.ok(r.redFlags.includes('pay_to_receive'));
});

test('no flags + AI off → UNSURE (goes to a human, never guessed)', async () => {
  const r = await scamCheck(offline(), 'Aap ka case number 1234 hai.', SECRET);
  assert.equal(r.verdict, 'UNSURE');
});

test('extraction: LLM never sees the CNIC, we fill it locally', async () => {
  let seen = '';
  const p: AiProvider = {
    id: 'groq',
    configured: true,
    isMock: false,
    async complete(req) {
      seen = req.messages[0]!.content;
      return {
        text: '{"intent":"claim_payment","fullName":"Zainab Bibi","district":"Thatta","householdSize":5,"isWidow":true,"confidence":0.9}',
        model: 'scripted',
      };
    },
  };
  const router = new AiRouter('dev', [p, new MockProvider()]);
  const r = await extractClaim(
    router,
    'Mera naam Zainab Bibi, CNIC 42101-1234567-3, Thatta, 5 log',
  );
  assert.ok(!seen.includes('42101'));
  assert.equal(r.extraction?.cnic, '42101-1234567-3');
  assert.equal(r.needsHuman, false);
  assert.deepEqual(r.extraction?.missingFields, []);
});

test('extraction: invalid model output twice → needs a human', async () => {
  const router = new AiRouter('dev', [scripted('not json at all'), new MockProvider()]);
  const r = await extractClaim(router, 'something unclear');
  assert.equal(r.needsHuman, true);
  assert.equal(r.reason, 'invalid_output');
});
