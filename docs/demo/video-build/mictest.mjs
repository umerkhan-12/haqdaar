// Checks that the fake microphone really plays our WAV: records 8 s in the page and saves it to audio/mictest.webm
import { writeFileSync } from 'node:fs';
import { launch, BASE } from './lib.mjs';

const s = await launch('phone', 'mictest', { record: false, wav: 'audio/claim-ur.wav' });
await s.page.goto(BASE + '/login');
const b64 = await s.page.evaluate(async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.start();
  await new Promise((r) => setTimeout(r, 8000));
  await new Promise((r) => { rec.onstop = r; rec.stop(); });
  const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
  let bin = '';
  for (const x of buf) bin += String.fromCharCode(x);
  return btoa(bin);
});
writeFileSync('audio/mictest.webm', Buffer.from(b64, 'base64'));
console.log('saved', b64.length);
await s.done();
