// node explore.mjs <phone|laptop> "<demo button label>" /path1 /path2 ...  → screenshots + control dump in explore/
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, BASE, sleep } from './lib.mjs';

const [kind, label, ...paths] = process.argv.slice(2);
mkdirSync('explore', { recursive: true });
const s = await launch(kind, 'explore', { record: false });
try {
  await s.login(label);
  console.log('after login:', s.page.url());
  for (const p of ['', ...paths]) {
    if (p) { await s.page.goto(BASE + p, { waitUntil: 'networkidle' }).catch(() => {}); await sleep(2500); }
    const tag = (kind + '-' + (p || s.page.url().replace(BASE, '')).replace(/[^a-z0-9]+/gi, '_')).slice(0, 60);
    await s.page.screenshot({ path: `explore/${tag}.png`, fullPage: true });
    const dump = await s.page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('button, a, input, select, textarea, [role=checkbox], [role=switch], h1, h2, h3')) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const txt = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').slice(0, 90);
        out.push(`${el.tagName.toLowerCase()}${el.type ? '[' + el.type + ']' : ''}${el.getAttribute('aria-label') ? ' aria=' + el.getAttribute('aria-label') : ''}${el.getAttribute('href') ? ' href=' + el.getAttribute('href') : ''} | ${txt}`);
      }
      return out.join('\n');
    });
    writeFileSync(`explore/${tag}.txt`, dump);
    console.log('==', p || '(landing)', '->', tag, '\n' + dump);
  }
} finally {
  await s.done();
}
