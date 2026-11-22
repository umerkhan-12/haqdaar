// Phone: "Is this message real?" with a fake relief SMS, then "Ask about the program" with sources.
import { sleep } from '../lib.mjs';

const SMS = 'Mubarak ho! Aap ka relief payment Rs 25000 manzoor. Fees Rs 500 Easypaisa 0300-1234567 par bhejein, link: bit.ly/relief';
const post = (page) => page.waitForResponse((r) => r.url().includes('/api/') && r.request().method() === 'POST', { timeout: 40000 }).catch(() => {});

export default async function scamask(s) {
  const { page, mark, click } = s;
  await s.login('Citizen — Zainab');
  mark('start');
  await sleep(1200);
  await click('a[href="/citizen/scam"]', { after: 1500 });
  mark('paste');
  const box = page.locator('main textarea');
  await box.click();
  await box.pressSequentially(SMS, { delay: 14 });
  await sleep(900);
  const done = post(page);
  await click(page.getByRole('button', { name: 'جانچیں' }), { after: 200 });
  await done;
  await sleep(1200);
  mark('verdict');
  await sleep(2500);
  await s.scroll(420, 1200);
  await sleep(3000);
  await click(page.locator('a[href="/citizen"]', { hasText: 'واپس' }), { after: 1400 });
  await click('a[href="/citizen/ask"]', { after: 1500 });
  mark('ask');
  const answered = post(page);
  await click(page.getByRole('button', { name: 'کون درخواست دے سکتا ہے؟' }), { after: 200 });
  await answered;
  await sleep(1500);
  mark('answer');
  await sleep(2000);
  await s.scroll(380, 1200);
  await sleep(2200);
  await s.scroll(380, 1200);
  await sleep(2500);
}
