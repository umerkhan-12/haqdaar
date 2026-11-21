/** Urdu has a separate word for every number up to 99, so they are listed, not built. */
const UNDER_100 = (
  'صفر ایک دو تین چار پانچ چھ سات آٹھ نو دس گیارہ بارہ تیرہ چودہ پندرہ سولہ سترہ اٹھارہ انیس ' +
  'بیس اکیس بائیس تئیس چوبیس پچیس چھبیس ستائیس اٹھائیس انتیس تیس اکتیس بتیس تینتیس چونتیس پینتیس چھتیس سینتیس اڑتیس انتالیس ' +
  'چالیس اکتالیس بیالیس تینتالیس چوالیس پینتالیس چھیالیس سینتالیس اڑتالیس انچاس پچاس اکیاون باون ترپن چون پچپن چھپن ستاون اٹھاون انسٹھ ' +
  'ساٹھ اکسٹھ باسٹھ تریسٹھ چونسٹھ پینسٹھ چھیاسٹھ سڑسٹھ اڑسٹھ انہتر ستر اکہتر بہتر تہتر چوہتر پچھتر چھہتر ستتر اٹھہتر اناسی ' +
  'اسی اکیاسی بیاسی تراسی چوراسی پچاسی چھیاسی ستاسی اٹھاسی نواسی نوے اکانوے بانوے ترانوے چورانوے پچانوے چھیانوے ستانوے اٹھانوے ننانوے'
).split(' ');

/**
 * A rupee amount in Urdu words ("بارہ ہزار"), so the Haq Receipt is spoken the way people say
 * money, not digit by digit. Whole numbers 0 to 99,999; anything else returns null and the
 * caller falls back to digits.
 */
export function urduNumberWords(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 99_999) return null;
  if (n < 100) return UNDER_100[n]!;
  const thousands = Math.floor(n / 1000);
  const hundreds = Math.floor((n % 1000) / 100);
  const rest = n % 100;
  return [
    thousands ? `${UNDER_100[thousands]} ہزار` : '',
    hundreds ? `${UNDER_100[hundreds]} سو` : '',
    rest ? UNDER_100[rest] : '',
  ]
    .filter(Boolean)
    .join(' ');
}
