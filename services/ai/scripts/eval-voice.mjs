#!/usr/bin/env node
// Urdu voice quality check: answers "does it really understand Urdu?" with numbers.
// Plays 24 synthetic claim utterances (services/ai/eval/voice/cases.json) through the real pipeline
// (POST /ai/transcribe → POST /ai/extract-claim via the gateway) and scores what comes back.
//
//   pnpm eval:voice                 run against http://127.0.0.1:4000 (services must be up)
//   pnpm eval:voice -- --label v2   tag the run (written into the JSON)
//   pnpm eval:voice -- --gen-only   only (re)create missing audio clips
//
// The clips are synthetic neural voices (Microsoft Edge TTS), NOT human recordings: no accents,
// no real room noise. They are generated once and committed so every run hears the same audio.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '../eval/voice');
const audioDir = join(dir, 'audio');
const BASE = process.env.EVAL_BASE_URL ?? 'http://127.0.0.1:4000';
const GAP_MS = 1500;
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? '') : null;
};
const label = flag('--label') ?? '';
const outFile = join(dir, flag('--out') ?? 'last-run.json');

const cases = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- audio (generated once, then reused) ----------
async function record(voice, text) {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const chunks = [];
    for await (const c of tts.toStream(text).audioStream) chunks.push(c);
    const audio = Buffer.concat(chunks);
    if (!audio.length) throw new Error('empty audio');
    return audio;
  } finally {
    tts.close();
  }
}

async function ensureAudio() {
  mkdirSync(audioDir, { recursive: true });
  let made = 0;
  for (const c of cases) {
    const file = join(audioDir, `${c.id}.mp3`);
    if (existsSync(file)) continue;
    for (let attempt = 1; ; attempt++) {
      try {
        writeFileSync(file, await record(c.voice, c.say ?? c.text));
        made++;
        break;
      } catch (err) {
        if (attempt === 3) throw new Error(`could not record ${c.id}: ${err.message}`);
        await sleep(1000);
      }
    }
  }
  if (made) console.log(`recorded ${made} new clip(s) → ${audioDir}`);
}

// ---------- scoring helpers ----------
const westernDigits = (t) => t.replace(/[۰-۹٠-٩]/g, (d) => String(d.charCodeAt(0) & 0xf));
const NUMBER_WORDS = { صفر: '0', زیرو: '0', ایک: '1', دو: '2', تین: '3', چار: '4', پانچ: '5', چھ: '6', سات: '7', آٹھ: '8', نو: '9' };

/** Same words → same tokens: digits in one script, no punctuation or vowel marks, one digit per token. */
function tokens(text) {
  return westernDigits(text)
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '') // Urdu vowel marks and stretch
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ۃة]/g, 'ہ')
    .replace(/\d/g, ' $& ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => NUMBER_WORDS[w] ?? w);
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

// Reimplementation of apps/web/features/citizen/claim-words.ts `matchDistrict` (the web is
// TypeScript with path aliases, so the tiny logic is copied here; keep the two in step).
const DISTRICTS = [
  ['Thatta', 'ٹھٹھہ'],
  ['Sujawal', 'سجاول'],
  ['Badin', 'بدین'],
  ['Tharparkar', 'تھرپارکر'],
  ['Karachi West', 'کراچی غربی'],
  ['Karachi East', 'کراچی شرقی'],
  ['Hyderabad', 'حیدرآباد'],
  ['Sukkur', 'سکھر'],
  ['Larkana', 'لاڑکانہ'],
];
const squash = (s) => s.toLowerCase().replace(/[^a-z؀-ۿ]/g, '');
function matchDistrict(heard) {
  const h = squash(heard ?? '');
  if (h.length < 3) return '';
  let best = { value: '', distance: Infinity };
  for (const [value, ur] of DISTRICTS) {
    for (const name of [squash(value), squash(ur)]) {
      if (h === name || h.includes(name)) return value;
      const distance = editDistance(h, name);
      if (distance < best.distance) best = { value, distance };
    }
  }
  return best.distance <= 2 ? best.value : '';
}

/** exact | near (within 2 letters: the app reads it back and she says yes/no) | wrong. */
function scoreName(got, c) {
  const want = c.expected.fullName;
  const g = squash(got ?? '');
  if (want === null) return g ? 'wrong' : 'exact';
  if (!g) return 'wrong';
  const accepted = [want, ...(c.acceptNames ?? [])].map(squash);
  if (accepted.includes(g)) return 'exact';
  return Math.min(...accepted.map((a) => editDistance(g, a))) <= 2 ? 'near' : 'wrong';
}

/** Which script speech-to-text wrote in: Whisper sometimes writes Urdu speech in Hindi letters. */
function scriptOf(text) {
  const n = (re) => (text.match(re) ?? []).length;
  const counts = { urdu: n(/[؀-ۿ]/g), devanagari: n(/[ऀ-ॿ]/g), latin: n(/[a-z]/gi) };
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top[1] ? top[0] : 'none';
}

/** Field scores for one extraction against one case (same rules for the spoken and the typed path). */
function scoreFields(x, c) {
  const got = {
    fullName: x?.fullName ?? null,
    cnic: x?.cnic ?? null,
    district: x?.district ?? null,
    householdSize: x?.householdSize ?? null,
  };
  return {
    got,
    name: scoreName(got.fullName, c),
    cnicOk: got.cnic === c.expected.cnic,
    districtOk: matchDistrict(got.district) === (c.expected.district ?? ''),
    districtCanonical: got.district === c.expected.district,
    householdOk: got.householdSize === c.expected.householdSize,
  };
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');
function quantile(values, q) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
}

// ---------- HTTP ----------
async function call(method, path, { token, body, form } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    signal: AbortSignal.timeout(60_000),
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON: keep null */
  }
  return { status: res.status, json, text };
}

async function login(phone) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await call('POST', '/auth/login', { body: { phone, password: 'demo1234' } });
      if (r.status < 300 && r.json?.accessToken) return r.json.accessToken;
      throw new Error(`login ${phone} → ${r.status}`);
    } catch (err) {
      if (attempt === 3) throw err;
      console.log(`${err.message}; services may be restarting, retrying in 60 s`);
      await sleep(60_000);
    }
  }
}

/** One step with timing. A 429 is retried once after a pause; the caller stops the run on repeats. */
async function timed(fn) {
  for (let attempt = 1; ; attempt++) {
    const t0 = performance.now();
    const r = await fn().catch((err) => ({ status: 0, json: null, text: String(err.message) }));
    const ms = Math.round(performance.now() - t0);
    if (r.status !== 429 || attempt === 2) return { ...r, ms };
    await sleep(8000);
  }
}

// ---------- run ----------
await ensureAudio();
if (args.includes('--gen-only')) process.exit(0);

const token = await login('03001110001');
let aiStatus = null;
try {
  const admin = await login('03001110004');
  const s = await call('GET', '/ai/status', { token: admin });
  if (s.status === 200) {
    const names = (chain) => chain.filter((p) => p.configured).map((p) => p.provider);
    aiStatus = { profile: s.json.profile, killed: s.json.killed, llm: names(s.json.llm), stt: names(s.json.stt) };
  }
} catch {
  /* status is context only; the run does not depend on it */
}

const rows = [];
let rateLimited = 0;
let stoppedEarly = false;
for (const c of cases) {
  const audio = readFileSync(join(audioDir, `${c.id}.mp3`));
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/mpeg' }), `${c.id}.mp3`);
  const stt = await timed(() => call('POST', '/ai/transcribe', { token, form }));
  await sleep(GAP_MS);
  const transcript = stt.json?.text ?? '';
  const ext =
    stt.status < 300 && transcript
      ? await timed(() => call('POST', '/ai/extract-claim', { token, body: { transcript } }))
      : null;
  await sleep(GAP_MS);

  if (stt.status === 429 || ext?.status === 429) {
    rateLimited++;
    if (rateLimited >= 2) {
      console.log(`stopping early at ${c.id}: rate limited (429) twice`);
      stoppedEarly = true;
      break;
    }
    continue;
  }

  // Roman Urdu is a way of WRITING Urdu, so those cases are also sent as typed text (helper path).
  let typed = null;
  if (c.lang === 'roman') {
    const t = await timed(() => call('POST', '/ai/extract-claim', { token, body: { transcript: c.text } }));
    await sleep(GAP_MS);
    if (t.status === 429) rateLimited++;
    else typed = { id: c.id, lang: 'typed', status: t.status, intent: t.json?.extraction?.intent ?? null, provider: t.json?.meta?.provider ?? null, ...scoreFields(t.json?.extraction ?? null, c) };
  }

  const x = ext?.json?.extraction ?? null;
  const scored = scoreFields(x, c);
  const { got } = scored;
  const ref = tokens(c.say ?? c.text);
  const nothing = Object.values(got).every((v) => v === null);
  const heardDigits = westernDigits(transcript).replace(/\D/g, '');
  rows.push({
    id: c.id,
    lang: c.lang,
    hard: c.hard ?? null,
    spoken: c.say ?? c.text,
    script: scriptOf(transcript),
    transcript,
    wer: { errors: editDistance(ref, tokens(transcript)), words: ref.length },
    expected: c.expected,
    got,
    intent: x?.intent ?? null,
    confidence: x?.confidence ?? null,
    name: scored.name,
    cnicOk: scored.cnicOk,
    districtOk: scored.districtOk,
    districtCanonical: scored.districtCanonical,
    householdOk: scored.householdOk,
    // All 13 digits are in the transcript, whatever the grouping (the server only accepts 5-7-1).
    cnicHeard: c.expected.cnic ? heardDigits.includes(c.expected.cnic.replace(/-/g, '')) : null,
    typed,
    notSure: stt.json?.understood === false || !ext || ext.json?.needsHuman === true || !x || nothing,
    reason: ext?.json?.reason ?? null,
    stt: { status: stt.status, ms: stt.ms, provider: stt.json?.provider ?? null, model: stt.json?.model ?? null },
    extract: ext
      ? { status: ext.status, ms: ext.ms, provider: ext.json?.meta?.provider ?? null, model: ext.json?.meta?.model ?? null, cached: ext.json?.meta?.cached ?? null }
      : null,
  });
  const r = rows.at(-1);
  console.log(
    `${c.id.padEnd(19)} name:${r.name.padEnd(5)} cnic:${r.cnicOk ? 'ok ' : 'NO '} district:${r.districtOk ? 'ok ' : 'NO '} household:${r.householdOk ? 'ok ' : 'NO '} ${r.notSure ? 'NOT-SURE ' : ''}stt ${stt.ms} ms, extract ${ext?.ms ?? '-'} ms`,
  );
}

// ---------- summary ----------
const count = (list, f) => list.filter(f).length;
const tally = (list, key) => {
  const out = {};
  for (const r of list) {
    const k = key(r);
    if (k) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};
const werOf = (list) => {
  const words = list.reduce((n, r) => n + r.wer.words, 0);
  return words ? list.reduce((n, r) => n + r.wer.errors, 0) / words : null;
};
const fields = (list) => ({
  n: list.length,
  nameExact: count(list, (r) => r.name === 'exact'),
  nameNear: count(list, (r) => r.name === 'near'),
  cnic: count(list, (r) => r.cnicOk),
  district: count(list, (r) => r.districtOk),
  districtCanonical: count(list, (r) => r.districtCanonical),
  household: count(list, (r) => r.householdOk),
  allFour: count(list, (r) => r.name === 'exact' && r.cnicOk && r.districtOk && r.householdOk),
});
const by = (lang) => rows.filter((r) => r.lang === lang);
const typedRows = rows.flatMap((r) => (r.typed ? [r.typed] : []));
const spokenUrdu = rows.filter((r) => r.lang === 'ur' || r.lang === 'roman');
const withCnic = rows.filter((r) => r.expected.cnic);
const empty = (r) => Object.values(r.expected).every((v) => v === null);
const invented = (r) =>
  ['fullName', 'cnic', 'district', 'householdSize'].filter((k) => r.expected[k] === null && r.got[k] !== null);
const sttMs = rows.filter((r) => r.stt.status === 200).map((r) => r.stt.ms);
const extMs = rows.filter((r) => r.extract?.status === 200 && !r.extract.cached).map((r) => r.extract.ms);

const summary = {
  label,
  at: new Date().toISOString(),
  base: BASE,
  cases: cases.length,
  scored: rows.length,
  stoppedEarly,
  aiStatus,
  providers: {
    stt: tally(rows, (r) => r.stt.provider && `${r.stt.provider} (${r.stt.model})`),
    extract: tally(rows, (r) => r.extract?.provider && `${r.extract.provider} (${r.extract.model})`),
  },
  wer: {
    urduSpeech: werOf(spokenUrdu),
    urduSpeechWrittenInUrdu: werOf(spokenUrdu.filter((r) => r.script === 'urdu')),
    en: werOf(by('en')),
    mixed: werOf(by('mixed')),
  },
  scripts: tally(spokenUrdu, (r) => r.script),
  cnic: { said: withCnic.length, heard: count(withCnic, (r) => r.cnicHeard), extracted: count(withCnic, (r) => r.cnicOk) },
  fields: { all: fields(rows), ur: fields(by('ur')), roman: fields(by('roman')), romanTyped: fields(typedRows), en: fields(by('en')), mixed: fields(by('mixed')) },
  intents: tally(rows, (r) => r.intent),
  notSure: {
    expected: count(rows, empty),
    correct: count(rows, (r) => empty(r) && r.notSure),
    onUsableSpeech: count(rows, (r) => !empty(r) && r.notSure),
  },
  inventedValues: rows.flatMap((r) => invented(r).map((k) => `${r.id}.${k}=${r.got[k]}`)),
  latencyMs: {
    transcribe: { median: quantile(sttMs, 0.5), p95: quantile(sttMs, 0.95) },
    extract: { median: quantile(extMs, 0.5), p95: quantile(extMs, 0.95) },
  },
};

const f = summary.fields;
const line = (name, g) =>
  `| ${name.padEnd(22)} | ${String(g.n).padStart(2)} | ${`${g.nameExact} (+${g.nameNear} near)`.padEnd(13)} | ${pct(g.cnic, g.n).padStart(5)} | ${pct(g.district, g.n).padStart(8)} | ${pct(g.household, g.n).padStart(9)} | ${pct(g.allFour, g.n).padStart(8)} |`;
const werText = (v) => (v === null ? 'n/a' : `${(100 * v).toFixed(1)}%`);
console.log(`
Voice eval ${label ? `[${label}] ` : ''}— ${rows.length}/${cases.length} clips scored${stoppedEarly ? ' (stopped early: rate limit)' : ''}
| Group                  |  n | Name exact    |  CNIC | District | Household | All four |
|------------------------|----|---------------|-------|----------|-----------|----------|
${line('All', f.all)}
${line('Urdu', f.ur)}
${line('Urdu (Roman cases)', f.roman)}
${line('Roman Urdu, typed', f.romanTyped)}
${line('English', f.en)}
${line('Code-switched', f.mixed)}
Word error rate: Urdu speech ${werText(summary.wer.urduSpeech)} as written, ${werText(summary.wer.urduSpeechWrittenInUrdu)} on the clips written back in Urdu script; English ${werText(summary.wer.en)}; code-switched ${werText(summary.wer.mixed)}
Script the Urdu clips came back in: ${JSON.stringify(summary.scripts)} (Hindi letters = right words, wrong alphabet, counted as errors)
CNIC: said in ${summary.cnic.said} clips, all 13 digits heard in ${summary.cnic.heard}, extracted by the server in ${summary.cnic.extracted}
District already canonical from the model (before the web's fuzzy match): ${f.all.districtCanonical}/${f.all.n}
"Not sure" when nothing usable was said: ${summary.notSure.correct}/${summary.notSure.expected}; "not sure" on usable speech: ${summary.notSure.onUsableSpeech}
Values returned that were never said: ${summary.inventedValues.length ? summary.inventedValues.join(', ') : 'none'}
Intent: ${JSON.stringify(summary.intents)}
Latency: transcribe median ${summary.latencyMs.transcribe.median} ms / p95 ${summary.latencyMs.transcribe.p95} ms; extract median ${summary.latencyMs.extract.median} ms / p95 ${summary.latencyMs.extract.p95} ms
Providers: speech ${JSON.stringify(summary.providers.stt)}; extraction ${JSON.stringify(summary.providers.extract)}`);

writeFileSync(outFile, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
console.log(`\nwrote ${outFile}`);
process.exit(rows.length ? 0 : 1);
