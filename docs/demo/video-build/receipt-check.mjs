// node receipt-check.mjs → a new citizen is paid, then her status screen is opened: is the Haq Receipt there?
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'https://172-198-74-124.sslip.io';
const B = BASE + '/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (method, path, { token, body, headers } = {}) => {
  const r = await fetch(B + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const rnd = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
const phone = '0349' + rnd(7);
await call('POST', '/auth/signup/start', { body: { phone } });
const code = String((await call('GET', `/mock/sms/signup/${phone}`)).body?.message?.body ?? '').match(/\b(\d{6})\b/)?.[1];
const tokens = (await call('POST', '/auth/signup/verify', { body: { phone, code, fullName: 'Receipt Tester', pin: '4826' } })).body;
const me = (await call('GET', '/auth/me', { token: tokens.accessToken })).body;
for (const purpose of ['identity_verification', 'household_data']) await call('POST', '/consents', { token: tokens.accessToken, body: { personId: me.personId, purpose } });
const c = (await call('POST', '/cases', { token: tokens.accessToken, headers: { 'idempotency-key': crypto.randomUUID() }, body: { type: 'relief_claim', fullName: 'Receipt Tester', cnic: `99${rnd(3)}-${rnd(7)}-${rnd(1)}`, district: 'Thatta', householdSize: 6, payout: { alias: phone } } })).body;
const sana = (await call('POST', '/auth/login', { body: { phone: '03001110003', password: 'demo1234' } })).body.accessToken;
await call('POST', `/cases/${c.id}/approve`, { token: sana, body: {} });
let status;
for (let i = 0; i < 15; i++) { await sleep(1500); status = (await call('GET', `/cases/${c.id}`, { token: tokens.accessToken })).body?.status; if (status === 'PAID') break; }
console.log('case status after approval:', status);

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ur-PK' });
const page = await ctx.newPage();
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
const inputs = page.locator('form input');
await inputs.nth(0).fill(phone);
await inputs.nth(1).fill('4826');
await page.locator('form button[type=submit]').click();
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
await page.goto(BASE + '/citizen/status', { waitUntil: 'networkidle' });
await sleep(2500);
await page.screenshot({ path: 'shots/_receipt.png', fullPage: true });
const text = await page.locator('main').innerText();
console.log(/12,?000|۱۲/.test(text) ? 'OK   the amount is on her status screen' : 'FAIL no amount on the status screen');
console.log(/رسید|Receipt/.test(text) ? 'OK   the Haq Receipt card is shown' : 'FAIL no receipt card');
await b.close();
