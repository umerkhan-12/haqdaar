// Laptop: officer Sana — queue, a case with AI notes and the decision line, approve, then the payouts page.
import { sleep } from '../lib.mjs';

export default async function officer(s) {
  const { page, mark, click } = s;
  await s.login('Officer — Sana');
  const rows = page.locator('section[aria-labelledby="queue-h"] ol li button');
  await rows.first().waitFor({ timeout: 20000 });
  mark('start');
  await sleep(2500);
  // Prefer Zainab's case (the one the phone just filed); otherwise the first in the queue.
  const zainab = rows.filter({ hasText: /Zainab/i });
  await click((await zainab.count()) ? zainab.first() : rows.first(), { after: 2200 });
  mark('case');
  await sleep(1500);
  const detail = page.locator('section[aria-label="Case detail"]');
  const decision = detail.getByRole('heading', { name: 'Decision' });
  if (await decision.count()) {
    await decision.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy({ top: -120 }));
    await page.mouse.move(700, 300, { steps: 10 });
  } else await s.scroll(350, 1000);
  mark('decision');
  await sleep(4000);
  await s.scroll(420, 1200);
  mark('notes');
  await sleep(3500);
  const approve = detail.getByRole('button', { name: 'Approve', exact: true });
  if (await approve.count()) {
    await click(approve, { after: 800 });
    mark('approve');
    await sleep(3000);
  } else {
    mark('noapprove');
    await sleep(2000);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await sleep(800);
  await click('a[href="/officer/payments"]', { after: 2000 });
  mark('payments');
  await sleep(2500);
  const rel = page.getByRole('button', { name: /Release/ }).first();
  if (await rel.count()) {
    await click(rel, { after: 2500 });
    mark('release');
    await sleep(1500);
    const cancel = page.locator('dialog[open]').getByRole('button', { name: /Cancel|Close|Back/i }).first();
    if (await cancel.count()) await click(cancel, { after: 1000 });
    else await page.keyboard.press('Escape');
  }
  await sleep(1500);
}
