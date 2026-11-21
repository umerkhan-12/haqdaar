import type { Extraction } from '@/lib/api';

/** What a claim needs from her, in the order we ask for it. */
export const FIELDS = ['fullName', 'cnic', 'district', 'householdSize', 'alias'] as const;
export type FieldName = (typeof FIELDS)[number];
export type Details = Record<FieldName, string>;

export const EMPTY: Details = {
  fullName: '',
  cnic: '',
  district: '',
  householdSize: '',
  alias: '',
};

/** Districts the program serves: the value the backend stores, and how it is written and spoken in Urdu. */
export const DISTRICTS: { value: string; ur: string }[] = [
  { value: 'Thatta', ur: 'ٹھٹھہ' },
  { value: 'Sujawal', ur: 'سجاول' },
  { value: 'Badin', ur: 'بدین' },
  { value: 'Tharparkar', ur: 'تھرپارکر' },
  { value: 'Karachi West', ur: 'کراچی غربی' },
  { value: 'Karachi East', ur: 'کراچی شرقی' },
  { value: 'Hyderabad', ur: 'حیدرآباد' },
  { value: 'Sukkur', ur: 'سکھر' },
  { value: 'Larkana', ur: 'لاڑکانہ' },
];

/** Urdu and Persian digits → 0-9, so a number spoken or typed in any script is the same number. */
export function westernDigits(text: string): string {
  return text.replace(/[۰-۹٠-٩]/g, (d) => String(d.charCodeAt(0) & 0xf));
}

/** 4210112345673 → 42101-1234567-3. Fewer digits stay partial (used while typing). */
export function formatCnic(v: string): string {
  const d = westernDigits(v).replace(/\D/g, '').slice(0, 13);
  return [d.slice(0, 5), d.slice(5, 12), d.slice(12)].filter(Boolean).join('-');
}

/** Any Pakistani mobile spelling (+92 300…, 0092…, 300…) → 03XXXXXXXXX, or '' if it is not one. */
export function formatMobile(v: string): string {
  const d = westernDigits(v)
    .replace(/\D/g, '')
    .replace(/^(0092|92)/, '0');
  const local = d.length === 10 && d.startsWith('3') ? `0${d}` : d;
  return /^03\d{9}$/.test(local) ? local : '';
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z؀-ۿ]/g, '');

/**
 * A heard or typed place → one of our districts, or '' when it is not clearly one of them.
 * Speech-to-text spells places loosely ("Thata", "Thatha"), so a near miss counts; an unclear place
 * stays empty and is asked again rather than guessed.
 */
export function matchDistrict(heard: string | null | undefined): string {
  const h = squash(heard ?? '');
  if (h.length < 3) return '';
  let best = { value: '', distance: Infinity };
  for (const d of DISTRICTS) {
    for (const name of [squash(d.value), squash(d.ur)]) {
      if (h === name || h.includes(name)) return d.value;
      const distance = editDistance(h, name);
      if (distance < best.distance) best = { value: d.value, distance };
    }
  }
  return best.distance <= 2 ? best.value : '';
}

export const districtLabel = (value: string, lang: 'ur' | 'en'): string =>
  lang === 'ur' ? (DISTRICTS.find((d) => d.value === value)?.ur ?? value) : value;

export const isValid: Record<FieldName, (v: string) => boolean> = {
  fullName: (v) => v.trim().length >= 2,
  cnic: (v) => /^\d{5}-\d{7}-\d$/.test(v),
  district: (v) => DISTRICTS.some((d) => d.value === v),
  householdSize: (v) => /^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 30,
  alias: (v) => /^03\d{9}$/.test(v),
};

/** The first thing we still need, or null when the claim is complete. */
export const firstMissing = (d: Details): FieldName | null =>
  FIELDS.find((f) => !isValid[f](d[f])) ?? null;

/**
 * Fold one answer into what we already know. A new valid value replaces the old one; silence, or
 * something that does not validate, never erases a value she already gave. When we asked for one
 * specific number and the model missed it, the digits in her own words are used directly.
 */
export function mergeHeard(
  known: Details,
  x: NonNullable<Extraction['extraction']> | null,
  transcript: string,
  asked: FieldName | null,
): Details {
  const digits = westernDigits(transcript).replace(/\D/g, '');
  const heard: Details = {
    fullName: x?.fullName?.trim() ?? '',
    cnic:
      formatCnic(x?.cnic ?? '') ||
      (asked === 'cnic' && digits.length === 13 ? formatCnic(digits) : ''),
    district: matchDistrict(x?.district) || (asked === 'district' ? matchDistrict(transcript) : ''),
    householdSize: x?.householdSize
      ? String(x.householdSize)
      : asked === 'householdSize' && /^\d{1,2}$/.test(digits)
        ? String(Number(digits))
        : '',
    alias: formatMobile(x?.phone ?? '') || (asked === 'alias' ? formatMobile(digits) : ''),
  };
  const next = { ...known };
  for (const f of FIELDS) if (isValid[f](heard[f])) next[f] = heard[f];
  return next;
}

/** "42101-1234567-3" → "4 2 1 0 1 …": read out digit by digit, the way people say card numbers. */
export const spellDigits = (v: string): string => v.replace(/\D/g, '').split('').join(' ');
