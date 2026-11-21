#!/usr/bin/env node
// Pre-records every fixed Urdu sentence of the web app (apps/web/lib/messages.ts) as an mp3 in
// apps/web/public/audio/, so the phone can speak with no network and no Urdu voice installed.
// Run `pnpm audio` after adding or changing a message. Existing files are kept; stale ones are removed.
// Needs Node 22.18+ (imports the .ts message file directly).
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { audioHash } from '../../../apps/web/lib/audio-hash.ts';
import { M } from '../../../apps/web/lib/messages.ts';

const VOICE = 'ur-PK-UzmaNeural';
const out = join(dirname(fileURLToPath(import.meta.url)), '../../../apps/web/public/audio');
mkdirSync(out, { recursive: true });

async function record(text) {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const chunks = [];
    for await (const c of tts.toStream(text).audioStream) chunks.push(c);
    const audio = Buffer.concat(chunks);
    if (!audio.length) throw new Error('empty audio');
    return audio;
  } finally {
    tts.close();
  }
}

const sentences = [...new Set(Object.values(M).map(([ur]) => ur.replace(/\s+/g, ' ').trim()))].filter((s) => /[؀-ۿ]/.test(s));
const wanted = new Set(sentences.map(audioHash));
let made = 0;
let failed = 0;
for (const text of sentences) {
  const file = join(out, `${audioHash(text)}.mp3`);
  if (existsSync(file)) continue;
  for (let attempt = 1; ; attempt++) {
    try {
      writeFileSync(file, await record(text));
      made++;
      break;
    } catch (err) {
      if (attempt === 3) {
        failed++;
        wanted.delete(audioHash(text));
        console.error(`FAILED: ${text} (${err.message})`);
        break;
      }
    }
  }
}
for (const f of readdirSync(out)) if (f.endsWith('.mp3') && !wanted.has(f.slice(0, -4))) rmSync(join(out, f));
writeFileSync(join(out, 'manifest.json'), JSON.stringify([...wanted].sort()));
console.log(`${wanted.size} sentences recorded (${made} new, ${failed} failed) → apps/web/public/audio`);
process.exit(failed ? 1 : 0);
