export interface PriorityInput {
  confidence: number | null;
  hardFlagCount: number;
  amount: number | null;
  createdAt: Date;
}

/**
 * Officer queue order = risk × amount × waiting time.
 * Risk rises as confidence falls and with each hard flag; waiting doubles the weight per day,
 * so nobody is starved at the bottom of the queue.
 */
export function priority(p: PriorityInput, now = new Date()): number {
  const risk = Math.min(2, Math.max(0.05, 1 - (p.confidence ?? 0.5) + 0.25 * p.hardFlagCount));
  const amountFactor = (p.amount ?? 12_000) / 1_000;
  const hoursWaiting = Math.max(0, (now.getTime() - p.createdAt.getTime()) / 3_600_000);
  return Math.round(risk * amountFactor * (1 + hoursWaiting / 24) * 100);
}
