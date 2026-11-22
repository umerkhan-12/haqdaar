// Phone: Zainab signs in, hears her home screen, claims by voice, scans her card, consents, gets a result.
import { resolve } from 'node:path';
import { BASE, sleep } from '../lib.mjs';

export default async function claim(s) {
  const { page, mark, click } = s;
  s.voice = 'voice';
  mark('login');
  await s.login('Citizen — Zainab');
  mark('home');
  await click('button[aria-label^="سنیں"]', { after: 2600 }); // "listen": the screen reads every option aloud
  await click('a[href="/citizen/claim"]', { after: 1800 });

  const mic = page.locator('main button[aria-label]:not([aria-label^="سنیں"])').first();
  const yes = page.getByRole('button', { name: 'جی ہاں، ٹھیک ہے' });
  const file = page.locator('input[type=file]');
  const settled = async () => {
    // wait until the app has finished listening: review, photo step, or a follow-up question
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      if (await yes.count()) return 'review';
      if (await file.count()) return 'photo';
      const busy = await page.getByText('سمجھ رہے ہیں').count();
      if (!busy && i > 3 && (await mic.count())) return 'ask';
    }
    return 'timeout';
  };

  // What she says depends on what the app asks: everything first, then only the missing field.
  const answerFor = async () => {
    const h = await page.locator('main h1').first().innerText();
    if (h.includes('شناختی کارڈ نمبر')) return ['cnic', 8200];
    if (h.includes('ضلع')) return ['district', 4200];
    if (h.includes('افراد')) return ['household', 4200];
    if (h.includes('نام')) return ['name', 4200];
    if (h.includes('نمبر')) return ['alias', 8000];
    return ['claim', 15500];
  };
  let state = 'ask';
  s.followUps = [];
  for (let attempt = 1; attempt <= 5 && state === 'ask'; attempt++) {
    const [what, ms] = await answerFor();
    if (attempt > 1) s.followUps.push(what);
    s.setMic(`audio/${what}-ur.wav`);
    mark(attempt === 1 ? 'mic' : attempt === 2 ? 'micmore' : 'micmore' + attempt);
    if (attempt > 1) await sleep(1800); // let the viewer read the follow-up question
    await click(mic, { after: 0 });
    await sleep(ms);
    await click(mic, { after: 300, before: 200 });
    if (attempt === 1) mark('understanding');
    state = await settled();
    console.log('voice attempt', attempt, what, '->', state);
  }
  console.log('follow-ups asked:', s.followUps.join(',') || 'none');
  if (state === 'ask' || state === 'timeout') {
    // Fallback: type instead
    s.voice = 'typed';
    mark('typed');
    await click(page.getByRole('button', { name: 'لکھ کر بتائیں' }));
    const inputs = page.locator('main input');
    await inputs.nth(0).fill('Zainab Bibi');
    await inputs.nth(1).fill('42201-1234567-4');
    await page.locator('main select').selectOption({ label: 'Thatta' }).catch(() => page.locator('main select').selectOption({ index: 1 }));
    await inputs.nth(2).fill('5');
    await inputs.nth(3).fill('03001110001');
    await sleep(800);
    await click(page.getByRole('button', { name: 'آگے', exact: true }));
    state = (await file.count()) ? 'photo' : 'review';
  }

  if (state === 'photo') {
    mark('photo');
    await sleep(1500);
    await file.setInputFiles(resolve('cardfix/genuine.jpg'));
    await page.getByText('تصویر جانچ رہے ہیں').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
    await sleep(2500);
    mark('photodone');
    const next = page.getByRole('button', { name: 'آگے', exact: true });
    if (await next.count() && await next.isEnabled()) await click(next, { after: 1200 });
    else await click(page.getByRole('button', { name: 'تصویر کے بغیر آگے بڑھیں' }), { after: 1200 });
  }

  await yes.waitFor({ timeout: 20000 });
  mark('review');
  await sleep(4000);
  await click(yes, { after: 1500 });

  mark('consent');
  const boxes = page.locator('[role=checkbox]');
  await boxes.first().waitFor();
  await sleep(1500);
  const n = await boxes.count();
  for (let i = 0; i < n; i++) await click(boxes.nth(i), { after: 700 });
  await click(page.getByRole('button', { name: 'درخواست بھیجیں' }), { after: 500 });
  await page.locator('a[href="/citizen/status"]').waitFor({ timeout: 40000 });
  mark('result');
  await sleep(5500);
}
