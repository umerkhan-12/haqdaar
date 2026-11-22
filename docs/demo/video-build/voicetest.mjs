// Debug: one voice attempt on the claim screen, printing the API responses.
import { launch, BASE, sleep } from './lib.mjs';

const s = await launch('phone', 'voicetest', { record: false, wav: 'audio/claim-ur.wav' });
s.page.on('response', async (r) => {
  const u = r.url();
  if (!u.includes('/api/') || r.request().method() === 'GET') return;
  let body = '';
  try { body = (await r.text()).slice(0, 700); } catch {}
  console.log(r.status(), r.request().method(), u.replace(BASE, ''), (r.request().postData() || '').length, body);
});
s.page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 200)); });
await s.login('Citizen — Zainab');
await s.page.goto(BASE + '/citizen/claim', { waitUntil: 'networkidle' });
await sleep(1500);
const mic = s.page.locator('main button[aria-label]:not([aria-label^="سنیں"])').first();
await mic.click();
await sleep(Number(process.argv[2] || 14500));
await mic.click();
await sleep(9000);
s.setMic('audio/district-ur.wav');
await mic.click();
await sleep(5000);
await mic.click();
await sleep(30000);
console.log((await s.page.locator('main').innerText()).slice(0, 600));
await s.done();
