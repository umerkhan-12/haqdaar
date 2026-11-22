// Phone: "Where is my money?" — status in plain words, the Haq Receipt of a paid claim, then consent take-back screen.
import { sleep } from '../lib.mjs';

export default async function receipt(s) {
  const { page, mark, click } = s;
  await s.login('Citizen — Zainab');
  mark('start');
  await click('a[href="/citizen/status"]', { after: 2500 });
  mark('status');
  await sleep(1500);
  const paid = page.getByRole('button', { name: /رقم مل گئی/ }).first();
  if (await paid.count()) {
    await click(paid, { after: 1500 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await sleep(800);
    mark('receipt');
    await sleep(4500);
  } else {
    mark('noreceipt');
    await s.scroll(400, 1000);
    await sleep(2500);
  }
  await click(page.locator('a[href="/citizen"]', { hasText: 'واپس' }), { after: 1300 });
  await click('a[href="/citizen/consents"]', { after: 2000 });
  mark('consents');
  const back = page.getByRole('button', { name: 'واپس لیں' }).first();
  if (await back.count()) {
    const b = await back.boundingBox();
    if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  }
  await sleep(4000);
}
