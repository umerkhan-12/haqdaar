// node offline.mjs → does the citizen claim work with no internet? (real browser, live site)
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'https://172-198-74-124.sslip.io';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ur-PK' });
const page = await ctx.newPage();
const say = (label, ok, detail = '') => console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
const posts = [];
page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/cases$/.test(r.url())) posts.push(Date.now()); });

await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Citizen — Zainab' }).click();
await page.locator('form button[type=submit]').click();
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
await page.goto(BASE + '/citizen/claim', { waitUntil: 'networkidle' });
await page.goto(BASE + '/citizen', { waitUntil: 'networkidle' });
// wait until the service worker has finished caching and controls the page (first visit only)
const t0 = Date.now();
await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
for (let i = 0; i < 60 && !(await page.evaluate(() => !!navigator.serviceWorker.controller)); i++) await sleep(1000);
console.log('     service worker ready after', Math.round((Date.now() - t0) / 1000), 's');
const sw = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()));
say('service worker is registered', sw);

await ctx.setOffline(true);
let loaded = true;
await page.goto(BASE + '/citizen/claim', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => (loaded = false));
await sleep(1500);
const hasUi = loaded && (await page.locator('main').count()) > 0;
say('claim screen opens with no internet', hasUi, loaded ? '' : 'navigation failed');
const banner = await page.getByText(/انٹرنیٹ نہیں|No internet/).count();
say('the screen says there is no internet', banner > 0);

if (hasUi) {
  await page.getByRole('button', { name: 'لکھ کر بتائیں' }).click();
  const inputs = page.locator('main input');
  await inputs.nth(0).fill('Zainab Bibi');
  await inputs.nth(1).fill('42201-1234567-4');
  await page.locator('main select').selectOption({ index: 1 });
  await inputs.nth(2).fill('5');
  await inputs.nth(3).fill('03001110001');
  await page.getByRole('button', { name: 'آگے', exact: true }).click();
  await sleep(800);
  const skip = page.getByRole('button', { name: 'تصویر کے بغیر آگے بڑھیں' });
  if (await skip.count()) await skip.click();
  const yes = page.getByRole('button', { name: 'جی ہاں، ٹھیک ہے' });
  await yes.waitFor({ timeout: 10000 }).catch(() => {});
  say('typed claim reaches the read-back step offline', (await yes.count()) > 0);
  if (await yes.count()) {
    await yes.click();
    const boxes = page.locator('[role=checkbox]');
    await boxes.first().waitFor({ timeout: 8000 }).catch(() => {});
    for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).click();
    await page.getByRole('button', { name: 'درخواست بھیجیں' }).click();
    await sleep(2500);
    const saved = await page.getByText(/فون میں محفوظ|Saved on your phone|انٹرنیٹ واپس/).count();
    await page.screenshot({ path: 'shots/_offline-saved.png' });
    say('submit offline: the claim is saved on the phone, not lost', saved > 0);
    const before = posts.length;
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await sleep(9000);
    await page.screenshot({ path: 'shots/_offline-sent.png' });
    say('back online: the saved claim is sent by itself', posts.length > before, `${posts.length - before} request(s)`);
  }
}
await b.close();
