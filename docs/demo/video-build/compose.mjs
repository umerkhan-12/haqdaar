// Builds the final video from storyboard.json: one 1920x1080 segment per scene, then joins them.
// node compose.mjs [sceneId ...]   (no ids = all scenes + final join)
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { L, P, CAP } from './overlay2.mjs';

const FPS = 30;
const MAX_SPEED = 1.6;
const OUT = '../haqdaar-demo.mp4';
const board = JSON.parse(readFileSync('storyboard.json', 'utf8'));
const only = process.argv.slice(2);
for (const d of ['seg', 'cap', 'art']) mkdirSync(d, { recursive: true });
for (const f of ['segoeui.ttf', 'segoeuib.ttf']) if (!existsSync(f)) copyFileSync(`C:/Windows/Fonts/${f}`, f);

const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const probe = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
const n = (x) => x.toFixed(3);

let lastPhoneStill = null;
let lastLaptopStill = null;
const report = [];
let clock = 0;

for (const sc of board) {
  const narr = sc.narration ? `audio/${sc.narration}.mp3` : null;
  const narrDur = narr ? probe(narr) : 0;
  const minDur = Math.max(sc.dur, narrDur + 0.9);
  const filters = [];
  const inputs = [];
  let D = minDur;
  const caps = []; // {a, b, text}
  let vlabel;

  if (sc.type === 'card') {
    inputs.push('-loop', '1', '-t', n(D), '-i', sc.image);
    filters.push(`[0:v]fps=${FPS},scale=1920:1080,format=yuv420p[vout]`);
    vlabel = 'vout';
  } else {
    const meta = JSON.parse(readFileSync(`raw/${sc.id}.json`, 'utf8'));
    // the recorder can start before the scene clock (slow first load): shift the cue marks by the difference
    const off = Math.max(0, probe(`raw/${sc.id}.webm`) - meta.dur + (sc.sync || 0));
    meta.dur += off;
    const marks = meta.marks.map((m) => ({ ...m, t: m.t + off }));
    const startMark = marks.find((m) => m.id === 'start');
    const t0 = startMark ? startMark.t : 0.4;
    const tEnd = meta.dur - 0.35;
    // Piecewise segments between cue marks; each can be sped up ("fast") to skip waiting.
    const cuts = [{ id: '_', t: t0 }, ...marks.filter((m) => m.t > t0 + 0.05 && m.t < tEnd)];
    const segs = cuts.map((c, i) => ({ id: c.id, a: c.t, b: i + 1 < cuts.length ? cuts[i + 1].t : tEnd, f: (sc.fast && sc.fast[c.id]) || 1 }));
    const natural = segs.reduce((s, x) => s + (x.b - x.a) / x.f, 0);
    const g = Math.min(MAX_SPEED, Math.max(1, natural / minDur));
    D = Math.max(minDur, natural / g);
    let t = 0;
    let capText = sc.captions._ || '';
    let capStart = 0;
    const parts = [];
    segs.forEach((x, i) => {
      if (sc.captions[x.id] !== undefined && x.id !== '_') {
        if (capText) caps.push({ a: capStart, b: t, text: capText });
        capText = sc.captions[x.id];
        capStart = t;
      }
      const sp = x.f * g;
      filters.push(`[0:v]trim=start=${n(x.a)}:end=${n(x.b)},setpts=(PTS-STARTPTS)/${n(sp)}[p${i}]`);
      parts.push(`[p${i}]`);
      t += (x.b - x.a) / sp;
    });
    if (capText) caps.push({ a: capStart, b: D + 1, text: capText });
    const phone = sc.type === 'phone';
    const box = phone ? P : L;
    inputs.push('-i', `raw/${sc.id}.webm`);
    filters.push(`${parts.join('')}concat=n=${parts.length}:v=1:a=0,fps=${FPS},${phone ? "crop=iw/2:ih/2:0:0," : ""}scale=${box.w}:${box.h},tpad=stop_mode=clone:stop_duration=90[act]`);
    // the other device: explainer panel (laptop) or last still, dimmed
    const other = phone ? (sc.panel || lastLaptopStill) : lastPhoneStill;
    const ob = phone ? L : P;
    const dim = '';
    filters.push(`color=c=0x0d0f1f:s=1920x1080:r=${FPS}:d=${n(D)}[bg]`);
    let cur = 'bg';
    if (other) {
      inputs.push('-loop', '1', '-t', n(D), '-i', other);
      filters.push(`[1:v]scale=${ob.w}:${ob.h}${dim}[oth]`, `[bg][oth]overlay=${ob.x}:${ob.y}[b1]`);
      cur = 'b1';
    }
    filters.push(`[${cur}][act]overlay=${box.x}:${box.y}:shortest=1[b2]`);
    inputs.push('-loop', '1', '-t', n(D), '-i', 'art/overlay.png');
    const ovIdx = other ? 2 : 1;
    let chain = `[b2][${ovIdx}:v]overlay=0:0`;
    writeFileSync(`cap/${sc.id}-title.txt`, sc.title || '');
    chain += `,drawtext=fontfile=segoeuib.ttf:textfile=cap/${sc.id}-title.txt:fontsize=22:fontcolor=0x7dd3fc:x=(w-text_w)/2:y=${CAP.titleY}`;
    caps.forEach((c, i) => {
      writeFileSync(`cap/${sc.id}-${i}.txt`, c.text);
      chain += `,drawtext=fontfile=segoeui.ttf:textfile=cap/${sc.id}-${i}.txt:fontsize=${c.text.length > 78 ? 31 : 36}:fontcolor=white:x=(w-text_w)/2:y=${CAP.textY}:enable='between(t,${n(c.a)},${n(c.b - 0.001)})'`;
    });
    filters.push(`${chain},format=yuv420p[vout]`);
    vlabel = 'vout';
    // still of this device for later scenes
    const still = `art/still-${sc.id}.png`;
    ff(['-sseof', '-0.6', '-i', `raw/${sc.id}.webm`, ...(phone ? ['-vf', 'crop=iw/2:ih/2:0:0'] : []), '-frames:v', '1', '-update', '1', still]);
    if (phone) lastPhoneStill = still; else lastLaptopStill = still;
  }

  report.push({ id: sc.id, start: clock, dur: D, narr: narrDur, title: sc.title || sc.id });
  clock += D;
  if (only.length && !only.includes(sc.id)) continue;

  // audio: narration starts 0.45 s in, padded with silence to the scene length
  const aIdx = inputs.filter((x) => x === '-i').length;
  if (narr) {
    inputs.push('-i', narr);
    filters.push(`[${aIdx}:a]adelay=450:all=1,apad,atrim=0:${n(D)},aresample=48000,aformat=channel_layouts=stereo[aout]`);
  } else {
    inputs.push('-f', 'lavfi', '-t', n(D), '-i', 'anullsrc=r=48000:cl=stereo');
    filters.push(`[${aIdx}:a]atrim=0:${n(D)}[aout]`);
  }
  writeFileSync(`seg/${sc.id}.filter`, filters.join(';\n'));
  ff([...inputs, '-/filter_complex', `seg/${sc.id}.filter`, '-map', `[${vlabel}]`, '-map', '[aout]', '-t', n(D), '-r', String(FPS),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', `seg/${sc.id}.mp4`]);
  console.log(`seg/${sc.id}.mp4  ${D.toFixed(1)}s (narration ${narrDur.toFixed(1)}s)`);
}

const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const lines = report.map((r) => `${mmss(r.start)}  ${r.dur.toFixed(1)}s  ${r.id}  — ${r.title}`);
writeFileSync('timeline.txt', lines.join('\n') + `\nTOTAL ${clock.toFixed(1)}s\n`);
console.log(lines.join('\n'), `\nTOTAL ${clock.toFixed(1)}s`);

if (!only.length) {
  writeFileSync('seg/list.txt', board.map((s) => `file '${s.id}.mp4'`).join('\n'));
  ff(['-f', 'concat', '-safe', '0', '-i', 'seg/list.txt', '-c', 'copy', '-movflags', '+faststart', OUT]);
  console.log('wrote', OUT, probe(OUT).toFixed(1) + 's');
}
