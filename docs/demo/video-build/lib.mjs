// Shared helpers: launch a recorded browser context (laptop or phone), human-paced clicks, cue marks.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, renameSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const BASE = process.env.BASE || 'https://172-198-74-124.sslip.io';
const MIC = resolve('audio', '_mic.wav');
export const sleep =(ms) => new Promise((r) => setTimeout(r, ms));

const CURSOR = `(() => {
  const mk = () => {
    let d = document.getElementById('__dot');
    if (!d) {
      d = document.createElement('div');
      d.id = '__dot';
      d.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:rgba(255,170,0,.45);border:2px solid rgba(255,255,255,.95);box-shadow:0 0 0 1px rgba(0,0,0,.45);left:-50px;top:-50px;transition:transform .12s';
      (document.body || document.documentElement).appendChild(d);
    }
    return d;
  };
  const mv = (e) => { const p = e.touches ? e.touches[0] : e; if (!p) return; const d = mk(); d.style.left = p.clientX + 'px'; d.style.top = p.clientY + 'px'; };
  const dn = (e) => { mv(e); const d = mk(); d.style.transform = 'scale(1.7)'; setTimeout(() => (d.style.transform = 'scale(1)'), 220); };
  for (const ev of ['mousemove', 'pointermove']) addEventListener(ev, mv, true);
  for (const ev of ['mousedown', 'pointerdown', 'touchstart']) addEventListener(ev, dn, true);
})();`;

export async function launch(kind, name, { record = true, wav } = {}) {
  const phone = kind === 'phone';
  const args = ['--autoplay-policy=no-user-gesture-required', '--mute-audio'];
  if (phone) {
    args.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream');
    // Chromium opens the file each time the microphone starts, so the scene can swap what is "said" (setMic).
    if (wav) { copyFileSync(resolve(wav), MIC); args.push(`--use-file-for-fake-audio-capture=${MIC}`); }
  }
  const setMic = (src) => copyFileSync(resolve(src), MIC);
  const browser = await chromium.launch({ headless: true, ...(process.env.CHANNEL ? { channel: process.env.CHANNEL } : {}), args });
  const size = phone ? { width: 390, height: 844 } : { width: 1280, height: 800 };
  const dir = resolve('raw', '_tmp_' + name);
  if (record) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); }
  const ctx = await browser.newContext({
    viewport: size,
    ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2, permissions: ['microphone'], locale: 'ur-PK' } : { locale: 'en-GB' }),
    ignoreHTTPSErrors: true,
    ...(record ? { recordVideo: { dir, size: phone ? { width: 780, height: 1688 } : size } } : {}),
  });
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  const t0 = Date.now();
  const marks = [];
  mkdirSync(resolve('shots'), { recursive: true });
  // A cue: the caption with this id starts here. Also saves a screenshot for review (taken a moment later).
  const mark = (id) => {
    marks.push({ id, t: (Date.now() - t0) / 1000 });
    console.log(`[${name}] ${((Date.now() - t0) / 1000).toFixed(1)}s ${id}`);
    setTimeout(() => page.screenshot({ path: resolve('shots', `${name}-${id}.png`) }).catch(() => {}), 1200);
  };

  // Human-paced click: move the pointer there, pause, click.
  const click = async (target, { after = 900, before = 450, force = false } = {}) => {
    const loc = (typeof target === 'string' ? page.locator(target) : target).locator('visible=true').first();
    await loc.waitFor({ state: 'visible', timeout: 20000 });
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    if (b) {
      const x = b.x + b.width / 2, y = b.y + b.height / 2;
      await page.mouse.move(x, y, { steps: phone ? 1 : 14 });
      await sleep(before);
    }
    await loc.click({ force });
    await sleep(after);
  };
  const type = async (target, text, { delay = 35, after = 500 } = {}) => {
    const loc = typeof target === 'string' ? page.locator(target).first() : target.first();
    await loc.click();
    await loc.pressSequentially(text, { delay });
    await sleep(after);
  };
  const scroll = async (dy, ms = 900) => {
    await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), dy);
    await sleep(ms);
  };
  const login = async (label) => {
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await sleep(900);
    if (!phone) {
      const en = page.getByRole('button', { name: 'English', exact: true });
      if (await en.count()) { await en.first().click(); await sleep(700); }
    }
    await click(page.getByRole('button', { name: label }), { after: 700 });
    await click(page.locator('form button[type=submit]'), { after: 300 });
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
    await sleep(1200);
  };
  const done = async () => {
    const dur = (Date.now() - t0) / 1000;
    const video = page.video();
    await ctx.close();
    if (record && video) {
      const p = await video.path();
      const out = resolve('raw', name + '.webm');
      if (existsSync(out)) rmSync(out);
      renameSync(p, out);
      rmSync(dir, { recursive: true, force: true });
      writeFileSync(resolve('raw', name + '.json'), JSON.stringify({ name, kind, dur, marks }, null, 1));
    }
    await browser.close();
  };
  return { setMic, browser, ctx, page, mark, click, type, scroll, login, done, phone };
}
