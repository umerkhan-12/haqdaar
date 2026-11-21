/**
 * Haq Receipt text. The amount is written in digits AND words so it can be read aloud and
 * checked against what an agent hands over: a middleman cannot quietly keep part of it.
 */
const ONES = ['', 'ek', 'do', 'teen', 'chaar', 'paanch', 'chhe', 'saat', 'aath', 'nau'];

/** Roman-Urdu words for amounts the program pays (thousands + hundreds), e.g. 12000 → "barah hazaar". */
const SPECIAL: Record<number, string> = {
  10: 'das',
  11: 'gyarah',
  12: 'barah',
  13: 'terah',
  14: 'chaudah',
  15: 'pandrah',
  16: 'solah',
  17: 'satrah',
  18: 'atharah',
  19: 'unees',
  20: 'bees',
  25: 'pachees',
  30: 'tees',
  40: 'chaalees',
  50: 'pachaas',
};

function below100(n: number): string {
  if (n < 10) return ONES[n]!;
  return SPECIAL[n] ?? String(n);
}

export function amountInWords(amount: number): string {
  const thousands = Math.floor(amount / 1000);
  const hundreds = Math.floor((amount % 1000) / 100);
  const rest = amount % 100;
  const parts: string[] = [];
  if (thousands) parts.push(`${below100(thousands)} hazaar`);
  if (hundreds) parts.push(`${ONES[hundreds]} sau`);
  if (rest) parts.push(below100(rest));
  return parts.join(' ') || 'sifar';
}

export function receiptText(amount: number, providerRef: string | null): string {
  const pkr = amount.toLocaleString('en-PK');
  return [
    `Sahara Program: Aap ke account mein Rs ${pkr} (${amountInWords(amount)} rupay) bhej diye gaye hain.`,
    `Yeh poori raqam aap ki hai. Koi is mein se paise mange to 1234 par shikayat karein.`,
    providerRef ? `Ref: ${providerRef}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}
