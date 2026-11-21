/**
 * AML-style velocity rule: one receiving account collecting payouts for many different people
 * is the classic mule pattern. Hold if the account already received for ≥ N other persons
 * within the window.
 */
export interface RecentPayout {
  personId: string;
  createdAt: Date;
}

export interface VelocityRule {
  windowMs: number;
  maxOtherPersons: number;
}

export const DEFAULT_VELOCITY: VelocityRule = { windowMs: 24 * 60 * 60_000, maxOtherPersons: 2 };

export function velocityBreached(
  personId: string,
  recent: RecentPayout[],
  now: Date,
  rule: VelocityRule = DEFAULT_VELOCITY,
): boolean {
  const since = now.getTime() - rule.windowMs;
  const others = new Set(
    recent
      .filter((p) => p.personId !== personId && p.createdAt.getTime() >= since)
      .map((p) => p.personId),
  );
  return others.size >= rule.maxOtherPersons;
}
