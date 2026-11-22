// node ui-check.mjs → screenshots of the newest screens on the live site (phone size), plus console errors
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'https://172-198-74-124.sslip.io';
const B = BASE + '/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (m, p, { token, body, headers } = {}) => { const r = await fetch(B + p, { method: m, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const rnd = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
const phone = '0349' + rnd(7);
await call('POST', '/auth/signup/start', { body: { phone } });
const code = String((await call('GET', `/mock/sms/signup/${phone}`)).body?.message?.body ?? '').match(/\b(\d{6})\b/)?.[1];
const token = (await call('POST', '/auth/signup/verify', { body: { phone, code, fullName: 'Screen Tester', pin: '4826' } })).body.accessToken;
const me = (await call('GET', '/auth/me', { token })).body;
for (const purpose of ['identity_verification', 'household_data']) await call('POST', '/consents', { token, body: { personId: me.personId, purpose } });
const c = (await call('POST', '/cases', { token, headers: { 'idempotency-key': crypto.randomUUID() }, body: { type: 'relief_claim', fullName: 'Screen Tester', cnic: `99${rnd(3)}-${rnd(7)}-${rnd(1)}`, district: 'Thatta', householdSize: 6, payout: { alias: phone } } })).body;
const sana = (await call('POST', '/auth/login', { body: { phone: '03001110003', password: 'demo1234' } })).body.accessToken;
await call('POST', `/cases/${c.id}/request-info`, { token: sana, body: { message: 'The CNIC on your card is different. Please send the correct number.' } });

const b = await chromium.launch();
const errors = [];
const open = async () => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ur-PK' });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 160)));
  page.on('pageerror', (e) => errors.push('PAGE ' + String(e).slice(0, 160)));
  return { ctx, page };
};
const loginForm = async (page, ph, pw) => {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  const inputs = page.locator('form input');
  await inputs.nth(0).fill(ph);
  await inputs.nth(1).fill(pw);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
};
{
  const { ctx, page } = await open();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'shots/_ui-login.png', fullPage: true });
  await page.goto(BASE + '/forgot-pin', { waitUntil: 'networkidle' });
  await sleep(800);
  await page.screenshot({ path: 'shots/_ui-forgot.png', fullPage: true });
  await loginForm(page, phone, '4826');
  await page.goto(BASE + '/citizen/status', { waitUntil: 'networkidle' });
  await sleep(2500);
  await page.screenshot({ path: 'shots/_ui-needsinfo.png', fullPage: true });
  console.log('correction card present:', (await page.getByText(/اپنی معلومات درست کریں/).count()) > 0);
  await page.goto(BASE + '/citizen/consents', { waitUntil: 'networkidle' });
  await sleep(2000);
  await page.screenshot({ path: 'shots/_ui-consents.png', fullPage: true });
  console.log('helper link card present:', (await page.getByText(/مددگار کو اجازت دیں/).count()) > 0);
  await ctx.close();
}
{
  const { ctx, page } = await open();
  await loginForm(page, '03001110003', 'demo1234');
  await page.goto(BASE + '/officer', { waitUntil: 'networkidle' });
  await sleep(2000);
  await page.screenshot({ path: 'shots/_ui-officer-list.png' });
  await page.locator('section[aria-labelledby="queue-h"] ol li button').first().click();
  await sleep(2500);
  await page.screenshot({ path: 'shots/_ui-officer-case.png' });
  console.log('back button present:', (await page.getByText('Back to the queue').count()) > 0);
  console.log('correction requests box present:', (await page.getByText(/Citizens say their information is wrong/).count()) > 0);
  await ctx.close();
}
await b.close();
console.log('console errors:', errors.length ? errors : 'none');
