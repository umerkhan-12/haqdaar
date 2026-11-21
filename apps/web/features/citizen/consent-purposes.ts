import type { Consent } from '@/lib/api';
import type { MessageKey } from '@/lib/i18n';

/** Plain-words description of one permission: WHO gets the data, WHY, and what taking it back does. */
export interface PurposeText {
  who: MessageKey;
  why: MessageKey;
  /** Shown before she takes it back; mirrors what the cases service really does on withdrawal. */
  consequence: MessageKey;
}

const PURPOSES: Record<string, PurposeText> = {
  identity_verification: {
    who: 'cIdentityWho',
    why: 'cIdentityWhy',
    consequence: 'takeBackIdentity',
  },
  household_data: { who: 'cHouseholdWho', why: 'cHouseholdWhy', consequence: 'takeBackHousehold' },
  payment: { who: 'cPaymentWho', why: 'cPaymentWhy', consequence: 'takeBackOther' },
  helper_access: { who: 'cHelperWho', why: 'cHelperWhy', consequence: 'takeBackOther' },
};
const OTHER: PurposeText = { who: 'cOtherWho', why: 'cOtherWhy', consequence: 'takeBackOther' };

/** The permissions a claim cannot be decided without (same list as the cases service). */
export const REQUIRED_PURPOSES = ['identity_verification', 'household_data'] as const;

/** Never a raw purpose code on screen: unknown purposes get a generic description. */
export const purposeText = (purpose: string): PurposeText => PURPOSES[purpose] ?? OTHER;

/** Required permissions that are not in force right now (a purpose holds while any row is ACTIVE). */
export function missingPurposes(consents: Consent[]): string[] {
  const active = new Set(consents.filter((c) => c.status === 'ACTIVE').map((c) => c.purpose));
  return REQUIRED_PURPOSES.filter((p) => !active.has(p));
}
