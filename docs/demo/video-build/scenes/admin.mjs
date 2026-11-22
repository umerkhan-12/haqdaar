// Laptop: admin Hira — rules + cost threshold + Digital Twin, Kill AI, Scam Map, Evaluation, Team, API docs, Judge Mode.
import { sleep } from '../lib.mjs';

export default async function admin(s) {
  const { page, mark, click } = s;
  await s.login('Admin — Hira');
  await page.getByRole('heading', { name: 'Rules and costs' }).waitFor();
  mark('start');
  await sleep(1500);
  const cost = page.getByText('Auto-approve only when confidence');
  if (await cost.count()) {
    const b = await cost.first().boundingBox();
    if (b) await page.mouse.move(b.x + 140, b.y + 12, { steps: 16 });
  }
  await sleep(2500);
  // Digital Twin: change a threshold, simulate against past claims, then undo (nothing is published).
  const thr = page.getByLabel(/Threshold for: The applicant is a widow/);
  await click(thr, { after: 200 });
  await thr.fill('6');
  await sleep(700);
  const twinDone = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/api/'), { timeout: 30000 }).catch(() => {});
  await click(page.getByRole('button', { name: 'Run Digital Twin' }), { after: 200 });
  await twinDone;
  await sleep(800);
  mark('twin');
  await s.scroll(420, 1000);
  await sleep(3500);
  const undo = page.getByRole('button', { name: 'Undo changes' });
  if (await undo.count()) { await undo.scrollIntoViewIfNeeded(); await click(undo, { after: 600 }); }
  await page.evaluate(() => window.scrollTo({ top: 0 }));

  await click('a[href="/admin/ai"]', { after: 1500 });
  mark('kill');
  try {
    await click(page.getByRole('button', { name: 'Kill AI…' }), { after: 1100 });
    await click(page.locator('dialog[open]').getByRole('button', { name: 'Kill AI', exact: true }), { after: 2600 });
    mark('killed');
  } finally {
    // Always switch the AI back on.
    const on = page.getByRole('button', { name: 'Turn AI on' });
    await on.waitFor({ timeout: 8000 }).catch(() => {});
    if (await on.count()) await click(on, { after: 1800 });
  }

  await click('a[href="/admin/scams"]', { after: 2200 });
  mark('scams');
  await s.scroll(380, 1000);
  await sleep(2300);

  await click('a[href="/admin/eval"]', { after: 2200 });
  mark('eval');
  await s.scroll(330, 1000);
  await sleep(2300);

  await click('a[href="/admin/users"]', { after: 2600 });
  mark('team');
  await click('a[href="/admin/docs"]', { after: 2400 });
  mark('docs');

  await click('a[href="/judge"]', { after: 1800 });
  mark('judge');
  const run = page.getByRole('button', { name: 'Run: Scams and fake messages (Haqdaar Seal)' });
  await run.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy({ top: 200 }));
  const ran = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/api/'), { timeout: 40000 }).catch(() => {});
  await click(run, { after: 200 });
  await ran;
  await sleep(1000);
  mark('judged');
  await sleep(4500);
}
