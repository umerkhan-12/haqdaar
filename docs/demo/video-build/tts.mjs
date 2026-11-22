// Generates narration mp3s (audio/<id>.mp3) from narration.json and the Urdu claim sentence WAV.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

mkdirSync('audio', { recursive: true });

async function record(voice, text) {
  for (let attempt = 1; ; attempt++) {
    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      const chunks = [];
      for await (const c of tts.toStream(text).audioStream) chunks.push(c);
      const audio = Buffer.concat(chunks);
      if (!audio.length) throw new Error('empty audio');
      return audio;
    } catch (e) {
      if (attempt === 3) throw e;
    } finally {
      tts.close();
    }
  }
}

const force = process.argv.includes('--force');
const urdu =
  'میرا نام زینب بی بی ہے۔ میں ٹھٹھہ سے ہوں۔ میرے گھر میں پانچ لوگ ہیں۔ میرا شناختی کارڈ نمبر چار دو دو صفر ایک، ایک دو تین چار پانچ چھ سات، چار ہے۔';
if (force || !existsSync('audio/claim-ur.wav')) {
  writeFileSync('audio/claim-ur.mp3', await record('ur-PK-UzmaNeural', urdu));
  // 1 s of silence first so the mic is open before speech starts; file loops in Chromium.
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', 'audio/claim-ur.mp3', '-af', 'adelay=800,apad=pad_dur=6', '-ar', '48000', '-ac', '1', 'audio/claim-ur.wav']);
  console.log('claim-ur.wav');
}

const narration = JSON.parse(readFileSync('narration.json', 'utf8'));
for (const [id, text] of Object.entries(narration)) {
  const f = `audio/${id}.mp3`;
  const tf = `audio/${id}.txt`;
  if (!force && existsSync(f) && existsSync(tf) && readFileSync(tf, 'utf8') === text) continue;
  writeFileSync(f, await record('en-GB-SoniaNeural', text));
  writeFileSync(tf, text);
  const d = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
  console.log(id, d);
}
