import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CircuitBreaker } from '@haqdaar/nest-kit';

export type SpeechLang = 'ur' | 'en';

/** Microsoft neural voices (free Edge read-aloud service): a Pakistani Urdu voice, and plain English. */
export const VOICES: Record<SpeechLang, string> = {
  ur: 'ur-PK-UzmaNeural',
  en: 'en-GB-SoniaNeural',
};

/** Turns one sentence into mp3 bytes. Injected so tests never touch the network. */
export type Synthesizer = (text: string, voice: string, timeoutMs: number) => Promise<Buffer>;

export class SpeechUnavailableError extends Error {}

/**
 * Text → spoken audio for people who cannot read. Every sentence is synthesised once and then served
 * from disk (the key is the voice plus the exact text), so repeats cost nothing and still work when
 * the voice vendor is down. A failing vendor trips the breaker; the caller then tells the phone to use
 * its own built-in voice, so speech is never a dead end.
 */
export class Speech {
  private readonly breaker = new CircuitBreaker('ai:speech', {
    failureThreshold: 3,
    resetAfterMs: 30_000,
  });
  private readonly inFlight = new Map<string, Promise<Buffer>>();
  readonly stats = { synthesized: 0, cacheHits: 0, failures: 0 };

  constructor(
    private readonly cacheDir: string,
    private readonly synthesize: Synthesizer,
    private readonly timeoutMs: number,
  ) {}

  get status() {
    return { voices: VOICES, circuit: this.breaker.status.state, ...this.stats };
  }

  async speak(text: string, lang: SpeechLang): Promise<{ audio: Buffer; cached: boolean }> {
    const clean = text.replace(/\s+/g, ' ').trim();
    const voice = VOICES[lang];
    const key = createHash('sha256').update(`${voice}\n${clean}`).digest('hex');
    const file = join(this.cacheDir, `${key}.mp3`);

    const hit = await readFile(file).catch(() => null);
    if (hit) {
      this.stats.cacheHits += 1;
      return { audio: hit, cached: true };
    }

    // Two people asking for the same new sentence at once share one vendor call.
    let job = this.inFlight.get(key);
    if (!job) {
      job = this.create(clean, voice, file).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, job);
    }
    return { audio: await job, cached: false };
  }

  private async create(text: string, voice: string, file: string): Promise<Buffer> {
    let audio: Buffer;
    try {
      audio = await this.breaker.exec(() => this.synthesize(text, voice, this.timeoutMs));
      if (audio.length === 0) throw new Error('empty audio');
    } catch (err) {
      this.stats.failures += 1;
      throw new SpeechUnavailableError((err as Error).message);
    }
    this.stats.synthesized += 1;
    // Write-then-rename: a crash mid-write can never leave half an mp3 in the cache.
    await mkdir(this.cacheDir, { recursive: true });
    await writeFile(`${file}.tmp`, audio);
    await rename(`${file}.tmp`, file).catch(() => undefined);
    return audio;
  }
}

/** The real synthesiser. A new connection per sentence keeps one stuck socket from blocking the next request. */
export const edgeSynthesizer: Synthesizer = async (text, voice, timeoutMs) => {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
  const tts = new MsEdgeTTS();
  let timer: NodeJS.Timeout | undefined;
  try {
    const work = (async () => {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(text);
      const chunks: Buffer[] = [];
      for await (const chunk of audioStream) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks);
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`speech timed out after ${timeoutMs} ms`)),
        timeoutMs,
      );
    });
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    tts.close();
  }
};
