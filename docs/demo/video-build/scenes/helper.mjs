// Phone: helper Asif picks a family, enters that family's PIN, and gets the acting-for banner.
import { sleep } from '../lib.mjs';

export default async function helper(s) {
  const { page, mark, click } = s;
  await s.login('Helper — shopkeeper Asif');
  const fam = page.locator('main ul li button');
  await fam.first().waitFor({ timeout: 20000 });
  mark('start');
  await sleep(3000);
  const z = fam.filter({ hasText: /Zainab|زینب/ });
  await click((await z.count()) ? z.first() : fam.first(), { after: 1500 });
  mark('pin');
  for (const d of '1111') await click(page.getByRole('button', { name: d, exact: true }), { after: 350, before: 250 });
  await page.getByText('آپ مدد کر رہے ہیں').first().waitFor({ timeout: 20000 }).catch(() => {});
  await sleep(600);
  mark('acting');
  await sleep(4500);
}
