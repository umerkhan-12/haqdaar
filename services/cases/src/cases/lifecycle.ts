import type { CaseStatus } from '@haqdaar/shared';

/**
 * The officer-side state machine in one place, as pure functions, so every illegal move is
 * refused the same way and can be unit-tested without a database.
 */

/** A human can decide (approve / reject / ask for info / escalate) only while the case is open for review. */
export const REVIEWABLE: CaseStatus[] = ['IN_REVIEW', 'NEEDS_INFO'];
/** Closing is filing away a finished case: money sent, or a human said no. Nothing else may be closed. */
export const CLOSABLE: CaseStatus[] = ['PAID', 'REJECTED'];
/** No officer action is possible any more. */
export const FINAL: CaseStatus[] = ['CLOSED'];

/** An escalated case jumps the queue: a supervisor should see it before routine work. */
export const ESCALATION_BOOST = 3;

export type OfficerMove = 'escalate' | 'close' | 'assign' | 'correct';

/** Why a move is not allowed, or null when it is. */
export function refusal(
  move: OfficerMove,
  c: { status: CaseStatus; escalatedAt: Date | null },
): string | null {
  switch (move) {
    case 'escalate':
      if (!REVIEWABLE.includes(c.status))
        return `Only a case waiting for review can be escalated (case is ${c.status})`;
      return c.escalatedAt ? 'Case is already escalated' : null;
    case 'close':
      return CLOSABLE.includes(c.status)
        ? null
        : `Only a PAID or REJECTED case can be closed (case is ${c.status})`;
    case 'assign':
      return REVIEWABLE.includes(c.status)
        ? null
        : `Only a case waiting for review can be assigned (case is ${c.status})`;
    case 'correct':
      return REVIEWABLE.includes(c.status)
        ? null
        : `Only a claim waiting for review can be corrected (claim is ${c.status})`;
  }
}

/** Queue priority after escalation. */
export function boosted(priority: number, escalated: boolean): number {
  return escalated ? priority * ESCALATION_BOOST : priority;
}
