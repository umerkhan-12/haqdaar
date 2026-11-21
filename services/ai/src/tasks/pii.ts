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
// Edges are "not a digit" rather than a word boundary, so a number glued to letters (cnic42101…) is still caught.
const CNIC_RE = /(?<!\d)(\d{5})[-\s]?(\d{7})[-\s]?(\d)(?!\d)/g;
// Pakistani mobiles in any grouping: 03xx-xxxxxxx, 0300-123-4567, 0300 123 4567, +92 3xx xxxxxxx, 00923xxxxxxxxx
const PHONE_RE = /(?<!\d)(?:(?:\+|00)?92[-\s]?|0)3\d{2}(?:[-\s]?\d){7}(?!\d)/g;

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
    phones.push(digits.replace(/^(?:0092|92)/, '0'));
    return `[PHONE_${phones.length}]`;
  });
  return { text, cnics, phones };
}
