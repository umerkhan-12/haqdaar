// Laptop: auditor Bilal — the hash-chained audit log and "Verify chain".
import { sleep } from '../lib.mjs';

export default async function auditor(s) {
  const { page, mark, click } = s;
  await s.login('Auditor — Bilal');
  await page.getByRole('heading', { name: 'Audit log' }).waitFor({ timeout: 20000 });
  await sleep(1200);
  mark('start');
  await sleep(1500);
  await s.scroll(300, 1000);
  await sleep(1500);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await sleep(700);
  const verified = page.waitForResponse((r) => r.url().includes('verify'), { timeout: 40000 }).catch(() => {});
  await click(page.getByRole('button', { name: 'Verify chain' }), { after: 200 });
  await verified;
  await sleep(800);
  mark('verified');
  await sleep(4500);
}
