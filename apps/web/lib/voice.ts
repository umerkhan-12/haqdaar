import recorded from '../public/audio/manifest.json';
import { audioHash } from './audio-hash';
import { getSession } from './session';

export type Lang = 'ur' | 'en';

const RECORDED = new Set<string>(recorded);
const BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';
/** Shortest valid silent mp3: played inside the first tap so iOS lets later speech start by itself. */
const SILENCE =
  'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

let player: HTMLAudioElement | null = null;
let unlocked = false;
/** Each `say` gets a turn number; a newer turn silences every older one. */
let turn = 0;
/** Sentences the server already spoke in this visit: sentence → blob URL. */
const spoken = new Map<string, string>();

function element(): HTMLAudioElement {
  player ??= new Audio();
  return player;
}

/**
 * Phones only allow sound that starts from a tap. One shared <audio> element, started once inside the
 * first tap anywhere, stays allowed for the rest of the visit, so screens can then speak on their own.
 */
export function unlockAudio(): void {
  if (unlocked || typeof window === 'undefined') return;
  unlocked = true;
  const el = element();
  el.src = SILENCE;
  el.play().then(
    () => el.pause(),
    () => (unlocked = false),
  );
}

export function stopSpeaking(): void {
  turn += 1;
  player?.pause();
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
}

function play(src: string, mine: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (mine !== turn) return resolve();
    const el = element();
    el.onended = () => resolve();
    el.onpause = () => resolve();
    el.onerror = () => reject(new Error('audio failed'));
    el.src = src;
    el.play().catch(reject);
  });
}

/** Server voice (natural Pakistani Urdu). Used for sentences with her own details, e.g. the amount. */
async function fromServer(text: string, lang: Lang): Promise<string> {
  const key = `${lang}\n${text}`;
  const hit = spoken.get(key);
  if (hit) return hit;
  const token = getSession()?.accessToken;
  if (!token) throw new Error('no session');
  const res = await fetch(`${BASE}/ai/speak`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ text, lang }),
  });
  if (!res.ok) throw new Error(`speak ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  spoken.set(key, url);
  return url;
}

/** Last resort: the phone's own voice. Many phones have no Urdu voice, so Hindi (same spoken language) comes next. */
function fromPhone(text: string, lang: Lang, mine: number): Promise<void> {
  return new Promise((resolve) => {
    if (mine !== turn || !('speechSynthesis' in window)) return resolve();
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text);
    const want = lang === 'ur' ? ['ur-PK', 'ur-IN', 'hi-IN'] : ['en-GB', 'en-US'];
    const voice = synth
      .getVoices()
      .find((v) => want.some((w) => v.lang.toLowerCase() === w.toLowerCase()));
    u.lang = voice?.lang ?? want[0]!;
    if (voice) u.voice = voice;
    u.rate = 0.9;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    synth.speak(u);
  });
}

/**
 * Speak sentences one after another; a new call interrupts the current one.
 * Each sentence takes the best voice available: a recording shipped with the app (instant, works with no
 * signal) → the server's Urdu voice → the phone's own voice. Speech never throws: silence is not an error
 * the user can act on, and the words are always on screen as well.
 */
export async function say(parts: string | string[], lang: Lang): Promise<void> {
  if (typeof window === 'undefined') return;
  stopSpeaking();
  const mine = turn;
  const sentences = (Array.isArray(parts) ? parts : [parts])
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  for (const text of sentences) {
    if (mine !== turn) return;
    try {
      const hash = lang === 'ur' ? audioHash(text) : '';
      await play(RECORDED.has(hash) ? `/audio/${hash}.mp3` : await fromServer(text, lang), mine);
    } catch {
      await fromPhone(text, lang, mine);
    }
  }
}
