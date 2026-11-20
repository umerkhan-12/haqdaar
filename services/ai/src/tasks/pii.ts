/**
 * PII never reaches an external model. CNICs and phone numbers are replaced with placeholders
 * before the prompt and restored locally from the vault afterwards.
 */
const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normalizeDigits(text: string): string {
  return text.replace(/[۰-۹٠-٩]/g, (d) => {
    const i = URDU_DIGITS.indexOf(d);
    return String(i >= 0 ? i : ARABIC_DIGITS.indexOf(d));
  });
}

// 13 digits, with or without dashes/spaces: 42101-1234567-3, 4210112345673, 42101 1234567 3
const CNIC_RE = /\b(\d{5})[-\s]?(\d{7})[-\s]?(\d)\b/g;
// Pakistani mobiles: 03xx-xxxxxxx, +92 3xx xxxxxxx, 923xxxxxxxxx
const PHONE_RE = /(?:\+?92[-\s]?|0)3\d{2}[-\s]?\d{7}\b/g;

export interface Redacted {
  text: string;
  cnics: string[];
  phones: string[];
}

export function redactPii(input: string): Redacted {
  const cnics: string[] = [];
  const phones: string[] = [];
  let text = normalizeDigits(input).replace(CNIC_RE, (_m, a, b, c) => {
    cnics.push(`${a}-${b}-${c}`);
    return `[CNIC_${cnics.length}]`;
  });
  text = text.replace(PHONE_RE, (m) => {
    const digits = m.replace(/\D/g, '');
    phones.push(digits.startsWith('92') ? `0${digits.slice(2)}` : digits);
    return `[PHONE_${phones.length}]`;
  });
  return { text, cnics, phones };
}
