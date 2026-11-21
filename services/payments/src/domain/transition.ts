import { randomUUID } from 'node:crypto';
import { canTransition, type PaymentState } from '@haqdaar/shared';

/** Returns why a transition is illegal, or null when it is allowed by the state machine. */
export function transitionError(from: PaymentState, to: PaymentState): string | null {
  return canTransition(from, to) ? null : `Illegal payment transition ${from} -> ${to}`;
}

/** ISO 20022 end-to-end id: max 35 chars, unique per payout, reused for every retry. */
export function newEndToEndId(now = new Date()): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase();
  return `HQ${day}${rand}`;
}
