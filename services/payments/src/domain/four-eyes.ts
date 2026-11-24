/**
 * Four-eyes rule for sending money: whoever asked for a payout to go out (the officer who approved the
 * claim, released a hold or asked for a retry) can never be the one who approves it.
 */
export const MAKER_ACTIONS = ['CLAIM_APPROVE', 'RELEASE', 'RETRY_REQUEST'] as const;
export type MakerAction = (typeof MAKER_ACTIONS)[number];

const WHY: Record<MakerAction, string> = {
  CLAIM_APPROVE: 'you approved this claim',
  RELEASE: 'you released this payout',
  RETRY_REQUEST: 'you asked for this payout to be sent again',
};

/** Why this person may not approve the payout, or null when they may. */
export function checkerRefusal(
  makerId: string,
  makers: { actorId: string; action: string }[],
  userId: string,
): string | null {
  const mine = makers.find(
    (m) => m.actorId === userId && (MAKER_ACTIONS as readonly string[]).includes(m.action),
  );
  if (mine)
    return `Four-eyes rule: ${WHY[mine.action as MakerAction]}, so a different officer must approve it.`;
  if (makerId === userId)
    return 'Four-eyes rule: you asked for this payout, so a different officer must approve it.';
  return null;
}

/**
 * A failed payout may be sent again by one officer alone only to the same account and within the
 * maker-checker limit. A new account, or a large amount, needs a second officer.
 */
export function retryNeedsSecondOfficer(
  amount: number,
  limit: number,
  correctedAlias: string | undefined,
  currentAlias: string | null,
): boolean {
  return amount > limit || (!!correctedAlias && correctedAlias !== currentAlias);
}

/** Hold reason a failed payout carries while its retry waits for a second officer. */
export const RETRY_AWAITING_APPROVAL = 'RETRY_AWAITING_APPROVAL';
