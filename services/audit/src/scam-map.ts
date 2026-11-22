/** The three audit event types the Scam Map is built from. */
export const SCAM_EVENT_TYPES = [
  'ai.scam.checked',
  'ai.scam.reported',
  'ai.scam.report_resolved',
] as const;

/** The slice of an audit row the map needs; payloads are read defensively (old rows, odd shapes). */
export interface ScamRow {
  type: string;
  occurredAt: Date;
  payload: unknown;
  actorId?: string | null;
}

type Verdict = 'GENUINE' | 'SCAM' | 'UNSURE';
type Label = 'confirmed_scam' | 'genuine';
interface Count {
  key: string;
  count: number;
}

export interface ScamReportView {
  reportId: string;
  at: string;
  verdict: Verdict;
  redFlags: string[];
  district: string | null;
  reporterRole: string;
  /** PII-masked text the citizen chose to show an officer. */
  text: string;
  label: Label | null;
  resolvedAt: string | null;
}

export interface ScamMap {
  days: number;
  since: string;
  generatedAt: string;
  /** True when the window held more rows than the cap, so the counts are a floor. */
  capped: boolean;
  total: number;
  byVerdict: Record<Verdict, number>;
  genuineWithSeal: number;
  /** Share of checks the system would not decide and sent to a person. */
  unsureShare: number;
  byFlag: Count[];
  byDistrict: Count[];
  byChannel: Count[];
  /** District × red flag, counted over SCAM verdicts only. */
  grid: { district: string; flag: string; count: number }[];
  byDay: { day: string; total: number; scam: number }[];
  byHour: { hour: number; total: number; scam: number }[];
  topCombinations: { flags: string[]; count: number }[];
  latest: {
    at: string;
    verdict: Verdict;
    confidence: number;
    redFlags: string[];
    district: string | null;
    channel: string;
  }[];
  reports: ScamReportView[];
  /** Human labels: a false alarm is a message we called SCAM or UNSURE that an officer found genuine. */
  humanReview: {
    reported: number;
    open: number;
    confirmedScam: number;
    genuine: number;
    falseAlarms: number;
    falseAlarmShare: number | null;
  };
}

/** Pakistan has one time zone and no daylight saving; days and hours are shown the way staff live them. */
const PKT_OFFSET_MS = 5 * 3_600_000;
const DAY_MS = 86_400_000;
const NO_DISTRICT = 'Unknown';
const VERDICTS: Verdict[] = ['GENUINE', 'SCAM', 'UNSURE'];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const flagsOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((f): f is string => typeof f === 'string') : [];
const verdictOf = (v: unknown): Verdict | null =>
  VERDICTS.includes(v as Verdict) ? (v as Verdict) : null;

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

const sorted = (map: Map<string, number>): Count[] =>
  [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

const pktDay = (d: Date) => new Date(d.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);
const pktHour = (d: Date) => new Date(d.getTime() + PKT_OFFSET_MS).getUTCHours();

/**
 * Turns audit rows into the Scam Map. Pure, so it is tested without a database.
 * Rows outside the window, unknown types and malformed payloads are skipped, never guessed.
 */
export function aggregateScamMap(
  rows: ScamRow[],
  opts: { days: number; now: Date; capped?: boolean },
): ScamMap {
  const since = new Date(opts.now.getTime() - opts.days * DAY_MS);
  const inWindow = rows
    .filter((r) => r.occurredAt >= since && r.occurredAt <= opts.now && isObject(r.payload))
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

  const byVerdict: Record<Verdict, number> = { GENUINE: 0, SCAM: 0, UNSURE: 0 };
  const flags = new Map<string, number>();
  const districts = new Map<string, number>();
  const channels = new Map<string, number>();
  const grid = new Map<string, number>();
  const combos = new Map<string, number>();
  const days = new Map<string, { total: number; scam: number }>();
  for (let i = opts.days - 1; i >= 0; i--) {
    days.set(pktDay(new Date(opts.now.getTime() - i * DAY_MS)), { total: 0, scam: 0 });
  }
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, scam: 0 }));
  const latest: ScamMap['latest'] = [];
  const reports = new Map<string, ScamReportView>();
  const labels = new Map<string, { label: Label; at: Date }>();
  let total = 0;
  let genuineWithSeal = 0;

  for (const r of inWindow) {
    const p = r.payload as Record<string, unknown>;
    const verdict = verdictOf(p.verdict);
    const redFlags = flagsOf(p.redFlags);
    const district = str(p.district);

    if (r.type === 'ai.scam.checked' && verdict) {
      total += 1;
      byVerdict[verdict] += 1;
      if (verdict === 'GENUINE' && p.sealValid === true) genuineWithSeal += 1;
      bump(districts, district ?? NO_DISTRICT);
      bump(channels, str(p.channel) ?? 'unknown');
      const isScam = verdict === 'SCAM';
      const day = days.get(pktDay(r.occurredAt));
      if (day) {
        day.total += 1;
        if (isScam) day.scam += 1;
      }
      const hour = hours[pktHour(r.occurredAt)]!;
      hour.total += 1;
      if (isScam) {
        hour.scam += 1;
        for (const f of redFlags) {
          bump(flags, f);
          bump(grid, `${district ?? NO_DISTRICT}|${f}`);
        }
        if (redFlags.length) bump(combos, [...redFlags].sort().join('+'));
      }
      if (latest.length < 10) {
        latest.push({
          at: r.occurredAt.toISOString(),
          verdict,
          confidence: typeof p.confidence === 'number' ? p.confidence : 0,
          redFlags,
          district,
          channel: str(p.channel) ?? 'unknown',
        });
      }
    } else if (r.type === 'ai.scam.reported' && verdict && str(p.reportId)) {
      reports.set(p.reportId as string, {
        reportId: p.reportId as string,
        at: r.occurredAt.toISOString(),
        verdict,
        redFlags,
        district,
        reporterRole: str(p.reporterRole) ?? 'citizen',
        text: str(p.text) ?? '',
        label: null,
        resolvedAt: null,
      });
    } else if (r.type === 'ai.scam.report_resolved' && str(p.reportId)) {
      const label = p.label === 'confirmed_scam' || p.label === 'genuine' ? p.label : null;
      // Rows are newest first, so the first label seen for a report is the officer's latest word.
      if (label && !labels.has(p.reportId as string)) {
        labels.set(p.reportId as string, { label, at: r.occurredAt });
      }
    }
  }

  for (const [id, l] of labels) {
    const report = reports.get(id);
    if (report) {
      report.label = l.label;
      report.resolvedAt = l.at.toISOString();
    }
  }
  const reportList = [...reports.values()];
  const resolved = reportList.filter((r) => r.label);
  const falseAlarms = resolved.filter((r) => r.label === 'genuine' && r.verdict !== 'GENUINE');

  return {
    days: opts.days,
    since: since.toISOString(),
    generatedAt: opts.now.toISOString(),
    capped: opts.capped ?? false,
    total,
    byVerdict,
    genuineWithSeal,
    unsureShare: total ? byVerdict.UNSURE / total : 0,
    byFlag: sorted(flags),
    byDistrict: sorted(districts),
    byChannel: sorted(channels),
    grid: [...grid.entries()].map(([k, count]) => {
      const [district, flag] = k.split('|') as [string, string];
      return { district, flag, count };
    }),
    byDay: [...days.entries()].map(([day, v]) => ({ day, ...v })),
    byHour: hours,
    topCombinations: sorted(combos)
      .slice(0, 5)
      .map((c) => ({ flags: c.key.split('+'), count: c.count })),
    latest,
    reports: reportList.slice(0, 30),
    humanReview: {
      reported: reportList.length,
      open: reportList.length - resolved.length,
      confirmedScam: resolved.filter((r) => r.label === 'confirmed_scam').length,
      genuine: resolved.filter((r) => r.label === 'genuine').length,
      falseAlarms: falseAlarms.length,
      falseAlarmShare: resolved.length ? falseAlarms.length / resolved.length : null,
    },
  };
}
