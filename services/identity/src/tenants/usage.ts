/** Pure helpers for the usage report (unit-tested in identity.test.ts). Days are UTC. */

export interface UsageRow {
  day: Date;
  service: string;
  requests: number;
  errors: number;
}

export interface AiRow {
  day: Date;
  calls: number;
  failures: number;
  fallbacks: number;
}

export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** The `days` UTC days ending today, oldest first. */
export function dayRange(days: number, now = new Date()): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, i) =>
    isoDay(new Date(today - (days - 1 - i) * 86_400_000)),
  );
}

export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** One entry per day (zero-filled), each with per-service counts and AI calls. */
export function dailyUsage(days: string[], rows: UsageRow[], ai: AiRow[]) {
  const byDay = new Map(
    days.map((d) => [
      d,
      {
        day: d,
        requests: 0,
        errors: 0,
        aiCalls: 0,
        services: {} as Record<string, { requests: number; errors: number }>,
      },
    ]),
  );
  for (const r of rows) {
    const d = byDay.get(isoDay(r.day));
    if (!d) continue;
    d.requests += r.requests;
    d.errors += r.errors;
    const s = (d.services[r.service] ??= { requests: 0, errors: 0 });
    s.requests += r.requests;
    s.errors += r.errors;
  }
  for (const a of ai) {
    const d = byDay.get(isoDay(a.day));
    if (d) d.aiCalls += a.calls;
  }
  return [...byDay.values()];
}

export function quotaView(monthlyRequestQuota: number, monthToDateRequests: number) {
  return {
    monthlyRequestQuota,
    monthToDateRequests,
    percentUsed: Math.round((monthToDateRequests / monthlyRequestQuota) * 1000) / 10,
    exceeded: monthToDateRequests > monthlyRequestQuota,
  };
}
