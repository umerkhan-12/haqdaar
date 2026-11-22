import { randomInt } from 'node:crypto';

/** Roles an admin may give a team member. Citizens sign up themselves; partners are API keys. */
export const TEAM_ROLES = ['officer', 'helper', 'auditor', 'admin'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export interface UserChange {
  role?: TeamRole;
  active?: boolean;
}

export interface ChangeContext {
  actorId: string;
  target: { id: string; role: string; active: boolean };
  change: UserChange;
  /** Active admins of the tenant, NOT counting the target. */
  otherActiveAdmins: number;
}

/**
 * Why a change is refused, or null when it is allowed. Pure so the lock-out rules are unit-tested:
 * a program must never end up with nobody able to manage it, and an admin must not be able to
 * (accidentally) remove their own access in the middle of a session.
 */
export function refuseChange(c: ChangeContext): string | null {
  const { target, change } = c;
  const demotes = change.role !== undefined && change.role !== 'admin' && target.role === 'admin';
  const disables = change.active === false && target.active;
  if (target.id === c.actorId && (demotes || disables)) {
    return 'You cannot disable yourself or remove your own admin role. Ask another admin.';
  }
  const wasActiveAdmin = target.role === 'admin' && target.active;
  if (wasActiveAdmin && (demotes || disables) && c.otherActiveAdmins === 0) {
    return 'This is the last active admin of the program. Add another admin first.';
  }
  return null;
}

/** What actually changes, as `from → to` strings for the audit trail. Empty = nothing to do. */
export function describeChanges(
  target: { role: string; active: boolean },
  change: UserChange,
): Record<string, { from: string; to: string }> {
  const out: Record<string, { from: string; to: string }> = {};
  if (change.role !== undefined && change.role !== target.role) {
    out.role = { from: target.role, to: change.role };
  }
  if (change.active !== undefined && change.active !== target.active) {
    out.active = { from: String(target.active), to: String(change.active) };
  }
  return out;
}

/** No 0/O, 1/l/I: the admin reads this out or types it for the new team member. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** One-time temporary password: 10 characters from a CSPRNG (~57 bits), shown once, stored hashed. */
export function temporaryPassword(length = 10): string {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

/** 923001234567 → 9230*****67: enough to recognise a colleague, not enough to call them. */
export function maskPhone(phone: string): string {
  return phone.replace(/^(.{4}).*(.{2})$/, '$1*****$2');
}
