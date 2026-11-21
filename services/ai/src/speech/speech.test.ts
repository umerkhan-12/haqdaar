import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Speech, SpeechUnavailableError, VOICES } from './speech';

const dir = () => mkdtemp(join(tmpdir(), 'hq-tts-'));

test('a repeated sentence is synthesised once and then served from disk', async () => {
  let calls = 0;
  const speech = new Speech(await dir(), async () => (calls++, Buffer.from('mp3')), 1000);
  const first = await speech.speak('آپ کی درخواست مل گئی', 'ur');
  const second = await speech.speak('  آپ کی   درخواست مل گئی ', 'ur');
  assert.equal(calls, 1);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.deepEqual(second.audio, Buffer.from('mp3'));
});

test('the cache survives a restart and is separate per voice', async () => {
  const cache = await dir();
  let calls = 0;
  const synth = async (_t: string, voice: string) => (calls++, Buffer.from(voice));
  await new Speech(cache, synth, 1000).speak('Claim received', 'en');
  const afterRestart = new Speech(cache, synth, 1000);
  assert.equal((await afterRestart.speak('Claim received', 'en')).cached, true);
  assert.deepEqual(
    (await afterRestart.speak('Claim received', 'ur')).audio,
    Buffer.from(VOICES.ur),
  );
  assert.equal(calls, 2);
});

test('two simultaneous requests for a new sentence share one vendor call', async () => {
  let calls = 0;
  const speech = new Speech(
    await dir(),
    async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return Buffer.from('mp3');
    },
    1000,
  );
  await Promise.all([
    speech.speak('ایک', 'ur'),
    speech.speak('ایک', 'ur'),
    speech.speak('ایک', 'ur'),
  ]);
  assert.equal(calls, 1);
});

test('vendor failure → SpeechUnavailableError, nothing cached, breaker opens after 3', async () => {
  const cache = await dir();
  let calls = 0;
  const speech = new Speech(
    cache,
    async () => {
      calls++;
      throw new Error('socket closed');
    },
    1000,
  );
  for (const text of ['a', 'b', 'c', 'd'])
    await assert.rejects(speech.speak(text, 'en'), SpeechUnavailableError);
  assert.equal(
    calls,
    3,
    'the 4th request is refused by the open breaker without calling the vendor',
  );
  assert.deepEqual(await readdir(cache).catch(() => []), []);
  assert.equal(speech.status.circuit, 'OPEN');
});

test('empty audio from the vendor is a failure, not a silent success', async () => {
  const speech = new Speech(await dir(), async () => Buffer.alloc(0), 1000);
  await assert.rejects(speech.speak('hello', 'en'), SpeechUnavailableError);
});
