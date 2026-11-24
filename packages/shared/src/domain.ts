import { z } from 'zod';

/** The five user roles, plus `partner` for API-key clients (client-credentials tokens). */
export const Role = z.enum(['citizen', 'helper', 'officer', 'admin', 'auditor', 'partner']);
export type Role = z.infer<typeof Role>;

/** What an API key may do. A partner token can only reach routes that declare one of these. */
export const ApiScope = z.enum(['scam:check', 'cases:status']);
export type ApiScope = z.infer<typeof ApiScope>;

export const TenantType = z.enum(['relief', 'fraud_desk']);
export type TenantType = z.infer<typeof TenantType>;

/** Decision lanes. Automation can approve or escalate — never reject. */
export const Lane = z.enum(['AUTO_APPROVE', 'ASK_MORE', 'HUMAN_REVIEW']);
export type Lane = z.infer<typeof Lane>;

export const CaseStatus = z.enum([
  'DRAFT',
  'SUBMITTED',
  'PROCESSING',
  'NEEDS_INFO',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'PAID',
  'CLOSED',
]);
export type CaseStatus = z.infer<typeof CaseStatus>;

export const CaseType = z.enum(['relief_claim', 'complaint', 'scam_report']);
export type CaseType = z.infer<typeof CaseType>;

/** Payout state machine (bank-grade): only these transitions are legal. */
export const PaymentState = z.enum([
  'CREATED',
  'AWAITING_APPROVAL',
  'APPROVED',
  'SENT',
  'SUCCESS',
  'FAILED',
  'UNKNOWN',
  'HELD',
  'REVERSAL_REQUESTED',
  'REVERSED',
]);
export type PaymentState = z.infer<typeof PaymentState>;

export const PAYMENT_TRANSITIONS: Record<PaymentState, readonly PaymentState[]> = {
  CREATED: ['AWAITING_APPROVAL', 'HELD'],
  AWAITING_APPROVAL: ['APPROVED', 'HELD'],
  APPROVED: ['SENT', 'HELD'],
  SENT: ['SUCCESS', 'FAILED', 'UNKNOWN'],
  UNKNOWN: ['SUCCESS', 'FAILED'],
  FAILED: ['SENT'],
  HELD: ['AWAITING_APPROVAL'],
  SUCCESS: ['REVERSAL_REQUESTED'],
  REVERSAL_REQUESTED: ['REVERSED', 'SUCCESS'],
  REVERSED: [],
};

export function canTransition(from: PaymentState, to: PaymentState): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

export const ConsentPurpose = z.enum([
  'identity_verification',
  'household_data',
  'payment',
  'helper_access',
]);
export type ConsentPurpose = z.infer<typeof ConsentPurpose>;

/** Whole rupees (the columns are integers), bounded and finite: an absurd value (or 1e400, which JSON
 * reads as Infinity) would push the auto-approve threshold to 1 or below 0 without anyone noticing. */
const Rupees = z.number().int().positive().max(10_000_000);
/** Cost model used to derive the auto-approve threshold (challenge 01). */
export const CostSettings = z.object({
  wrongApproval: Rupees,
  humanReview: Rupees,
  askMore: Rupees,
});
export type CostSettings = z.infer<typeof CostSettings>;

export const DEFAULT_COSTS: CostSettings = {
  wrongApproval: 25_000,
  humanReview: 300,
  askMore: 150,
};

/** Auto-approve only if expected cost of approving < cost of a human review: (1-p)*W < R. */
export function autoApproveThreshold(c: CostSettings): number {
  return 1 - c.humanReview / c.wrongApproval;
}

/** Cost settings that would auto-approve below this confidence are refused (wrong approval ≥ 10 × review). */
export const MIN_AUTO_APPROVE_THRESHOLD = 0.9;
