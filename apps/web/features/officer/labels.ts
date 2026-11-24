/**
 * Plain-English names for the raw strings the backend stores, so an officer never has to decode
 * `duplicate_claim_this_month`. Unknown values fall back to the raw string with underscores removed:
 * a new backend flag is still shown, never hidden.
 */

const readable = (raw: string) => raw.replace(/[_.]/g, ' ');

/** Flag → [label, what it means for the officer]. Hard flags come from the engine, soft flags from the AI notes. */
const FLAGS: Record<string, [string, string]> = {
  deceased: [
    'Listed as deceased',
    'The identity record says this person has died. Do not pay without checking in person.',
  ],
  identity_not_found: [
    'CNIC not found',
    'The NADRA identity record (simulated: see the synthetic registry sheet) has no person with this CNIC number.',
  ],
  name_mismatch: [
    'Name does not match',
    'The name on the claim is not close enough to the name on the identity record.',
  ],
  duplicate_claim_this_month: [
    'Second claim this month',
    'Another claim for the same CNIC already exists this month.',
  ],
  household_not_found: [
    'No household record',
    'The household registry (simulated) has no household for this CNIC, so income and household size could not be verified.',
  ],
  verification_unavailable: [
    'Checks were down',
    'Identity or household systems did not answer, so nothing was verified.',
  ],
  consent_withdrawn: [
    'Consent withdrawn',
    'The citizen withdrew permission to use her data after submitting.',
  ],
  ai_unsure_speech: [
    'AI was not sure',
    'The AI was not confident it understood her speech. Compare the transcript with the claim.',
  ],
  ai_cnic_differs_from_typed: [
    'Heard a different CNIC',
    'The CNIC the AI heard is not the CNIC on the claim.',
  ],
  ai_missing_fields: [
    'Details typed by hand',
    'The AI could not find some details in her speech; they were typed or confirmed by hand.',
  ],
  document_needs_review: [
    'CNIC photo failed a check',
    'At least one automatic check on the card photo failed. See the document check below.',
  ],
  document_unreadable: [
    'CNIC photo unreadable',
    'The photo was too blurry or no number could be read from it.',
  ],
  document_cnic_mismatch: [
    'Card shows another CNIC',
    'The number on the photographed card is not the CNIC on the claim.',
  ],
  'anomaly:shared_payout': [
    'Shared payout account',
    'Several different people are being paid into the same account or mobile wallet. Often one person collecting for many.',
  ],
  'anomaly:helper_velocity': [
    'Helper filing very fast',
    'One helper submitted an unusual number of claims within an hour.',
  ],
  'anomaly:household_pattern': [
    'Copy-paste households',
    'Many claims from one district share the same household details within a day.',
  ],
  'anomaly:identity_collision': [
    'Same identity, different people',
    'This CNIC appears on claims whose name or other details do not agree.',
  ],
  cnic_photo_skipped: [
    'No CNIC photo',
    'She did not take a photo of her card. The identity record check still ran.',
  ],
};

/** One sentence of evidence for a fraud-ring signal: what was counted, against which limit. */
export function anomalyEvidence(a: { type: string; observedCount: number; threshold: number }) {
  const n = a.observedCount;
  switch (a.type) {
    case 'shared_payout':
      return `${n} different people share this payout account (limit ${a.threshold}).`;
    case 'helper_velocity':
      return `${n} claims from the same helper in one hour (limit ${a.threshold}).`;
    case 'household_pattern':
      return `${n} people with the same household details in one day (limit ${a.threshold}).`;
    case 'identity_collision':
      return `${n} details disagree for the same CNIC (limit ${a.threshold}).`;
    default:
      return `Observed ${n}, limit ${a.threshold}.`;
  }
}

export function flagLabel(flag: string): { label: string; meaning: string } {
  const f = FLAGS[flag];
  return f
    ? { label: f[0], meaning: f[1] }
    : { label: readable(flag), meaning: 'No description for this flag yet.' };
}

/** Document check id → what a FAILED check means, in one sentence. */
const CHECKS: Record<string, [string, string]> = {
  cnic_read: ['Card number read', 'The card number could not be read from the photo.'],
  qr_read: ['QR code read', 'A QR code was found but it holds no CNIC number.'],
  ocr_matches_qr: [
    'Printed number matches QR',
    'The printed number and the number inside the QR code are different.',
  ],
  typed_matches_card: [
    'Claim matches card',
    'The CNIC on the claim is not the number on the card.',
  ],
  compression_consistent: [
    'No edited areas',
    'Part of the image was saved differently from the rest, which can mean it was edited.',
  ],
  no_editor_software: ['Not saved by an editor', 'The photo was saved by image-editing software.'],
  sharp_enough: ['Sharp enough', 'The photo is too blurry to trust.'],
  card_not_expired: ['Card not expired', 'The card has expired.'],
  ai_available: [
    'Automatic checks on',
    'Automatic checks were switched off (Kill AI), so nothing was checked by machine.',
  ],
};

export function checkLabel(id: string): { label: string; failure: string } {
  const c = CHECKS[id];
  return c
    ? { label: c[0], failure: c[1] }
    : { label: readable(id), failure: 'This check failed.' };
}

const MISSING: Record<string, string> = {
  fullName: 'full name',
  cnic: 'CNIC number',
  phone: 'phone number',
  district: 'district',
  householdSize: 'household size',
  isWidow: 'whether she is a widow',
};
export const missingLabel = (f: string) => MISSING[f] ?? readable(f);

const REASONS: Record<string, string> = {
  low_confidence: 'its confidence was below the level where it trusts itself',
  ai_killed: 'AI is switched off (Kill AI)',
  ai_unavailable: 'the AI service did not answer',
  invalid_output: 'the AI answer could not be read',
};
export const reasonLabel = (r: string) => REASONS[r] ?? readable(r);

const LANES: Record<string, string> = {
  AUTO_APPROVE: 'Approved automatically',
  ASK_MORE: 'Waiting for the citizen',
  HUMAN_REVIEW: 'Needs an officer',
};
export const laneLabel = (lane: string | null) => (lane ? (LANES[lane] ?? readable(lane)) : 'New');

const STATUSES: Record<string, string> = {
  SUBMITTED: 'Submitted',
  PROCESSING: 'Processing',
  NEEDS_INFO: 'Waiting for the citizen',
  IN_REVIEW: 'In review',
  APPROVED: 'Approved, payout pending',
  REJECTED: 'Rejected',
  PAID: 'Paid',
  CLOSED: 'Closed',
};
export const statusLabel = (s: string) => STATUSES[s] ?? readable(s);

const TIMELINE: Record<string, string> = {
  submitted: 'Claim submitted',
  decision: 'Automatic decision',
  approved: 'Approved by an officer',
  rejected: 'Rejected by an officer',
  info_requested: 'Officer asked the citizen for information',
  info_provided: 'Citizen corrected their details',
  assigned: 'Assigned to an officer',
  escalated: 'Escalated to a supervisor',
  closed: 'Case closed',
  consent_withdrawn: 'Citizen withdrew consent',
  district_corrected: 'District corrected by officer',
  household_corrected: 'Household size corrected by officer',
  'payment.success': 'Payment sent',
  'payment.failed': 'Payment failed',
  'payment.unknown': 'Payment result unknown',
  'payment.held': 'Payment held',
  'payment.sent': 'Payment submitted to the bank',
  'payment.approved': 'Payment approved',
  'payment.created': 'Payment created',
  'payment.awaiting_approval': 'Payment waiting for a second officer',
  'payment.reversed': 'Payment reversed',
};

/** Timeline line: what happened and who did it ("you", "system", or a short id). */
export function timelineLabel(
  e: { type: string; actor: string; data: unknown },
  me?: string,
): string {
  const who =
    e.actor === 'system'
      ? 'system'
      : e.actor.startsWith('service:')
        ? e.actor.slice(8)
        : e.actor === me
          ? 'you'
          : `staff ${e.actor.slice(0, 8)}`;
  const d = (e.data ?? {}) as {
    reason?: string;
    message?: string;
    note?: string | null;
    from?: string | number | null;
    to?: string | number | null;
  };
  const change =
    e.type.endsWith('_corrected') && d.to != null ? `${d.from ?? 'none'} → ${d.to}` : null;
  const detail = change ?? d.reason ?? d.message ?? d.note;
  return `${TIMELINE[e.type] ?? readable(e.type)} · ${who}${detail ? ` · “${detail}”` : ''}`;
}

/** "you" or a short id: there is no staff directory in the prototype. */
export const staffName = (id: string | null, me?: string) =>
  !id ? 'nobody' : id === me ? 'you' : `officer ${id.slice(0, 8)}`;

const PAYMENT_STATES: Record<string, string> = {
  CREATED: 'Created',
  AWAITING_APPROVAL: 'Waiting for a second officer',
  APPROVED: 'Approved, sending',
  SENT: 'Sent to the bank',
  SUCCESS: 'Paid',
  FAILED: 'Failed',
  UNKNOWN: 'Bank did not answer',
  HELD: 'Held for a check',
  REVERSAL_REQUESTED: 'Reversal requested',
  REVERSED: 'Reversed',
};
export const paymentStateLabel = (s: string) => PAYMENT_STATES[s] ?? readable(s);

/** Why a payout is held, failed or waiting, in words an officer can act on. */
const HOLDS: Record<string, string> = {
  TITLE_MISMATCH:
    'The bank account is in a different name than the claimant. Check with her before releasing.',
  ACCOUNT_NOT_FOUND:
    'The bank has no account for this mobile number. Ask the claimant for the correct number.',
  TITLE_FETCH_UNAVAILABLE: 'The bank could not be asked whose account this is. Try again shortly.',
  VELOCITY:
    'This account received payouts for several other people today. Often one person collecting for many.',
  RETRY_AWAITING_APPROVAL: 'Sent again by an officer; a different officer must approve the retry.',
  ABOVE_MAKER_CHECKER_LIMIT: 'Large amount: a second officer must approve it.',
  INQUIRY_NOT_RECEIVED_SAFE_TO_RETRY: 'The bank never received it. It is safe to send again.',
  INQUIRY_CONFIRMED_RJCT: 'The bank confirmed it rejected the transfer.',
  NO_RESPONSE_FROM_RAAST: 'The bank did not answer. Ask the bank (inquiry) before paying again.',
};

/** Bank and rail codes in words an officer can act on. */
export function plainReason(code: string | null | undefined): string {
  if (!code) return 'No reason recorded';
  if (HOLDS[code]) return HOLDS[code];
  if (/AC0[134]|ACCOUNT_NOT_FOUND|not found|no such account/i.test(code))
    return HOLDS.ACCOUNT_NOT_FOUND;
  if (/timeout|UNKNOWN|no answer/i.test(code)) return HOLDS.NO_RESPONSE_FROM_RAAST;
  if (/RJCT|REJECT/i.test(code))
    return `The bank rejected the transfer (${code.replace(/^(RJCT|REQUEST_REJECTED):\s*/i, '')}).`;
  return readable(code);
}
