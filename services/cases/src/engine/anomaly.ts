export const ANOMALY_WINDOWS = {
  sharedPayoutMs: 30 * 24 * 60 * 60_000,
  helperVelocityMs: 60 * 60_000,
  householdPatternMs: 24 * 60 * 60_000,
  identityCollisionMs: 30 * 24 * 60 * 60_000,
} as const;

export const DEFAULT_ANOMALY_THRESHOLDS = {
  sharedPayoutPeople: 2,
  helperClaimsPerHour: 10,
  householdPatternPeople: 5,
  identityCorroboratingDetails: 2,
} as const;

export type AnomalyType =
  'shared_payout' | 'helper_velocity' | 'household_pattern' | 'identity_collision';
export type AnomalyCandidateGroups = Partial<Record<AnomalyType, ReadonlySet<string>>>;
export type AnomalyFlag = `anomaly:${AnomalyType}`;

export function isAnomalyFlag(flag: string): flag is AnomalyFlag {
  return flag.startsWith('anomaly:');
}

/**
 * Anomaly flags are for officers and auditors only. A citizen or helper who could see them would
 * learn which fraud check fired, so every non-staff view passes its flags through this.
 */
export function flagsVisibleTo(flags: readonly string[], staff: boolean): string[] {
  return staff ? [...flags] : flags.filter((flag) => !isAnomalyFlag(flag));
}

export interface AnomalyObservation {
  tenantId: string;
  caseId: string;
  status: string;
  personId: string;
  /** HMAC of the CNIC. The evaluator never needs the plaintext CNIC. */
  cnicHash: string;
  nameNormalized: string;
  district: string | null;
  payoutKey: string | null;
  helperId: string | null;
  householdSize: number | null;
  createdAt: Date;
}

export interface AnomalyThresholds {
  sharedPayoutPeople: number;
  helperClaimsPerHour: number;
  householdPatternPeople: number;
  identityCorroboratingDetails: number;
}

export interface AnomalySignal {
  type: AnomalyType;
  /** Internal grouping key; callers must hash it before persistence or returning it. */
  groupKey: string;
  evidenceCaseIds: string[];
  observedCount: number;
  threshold: number;
  windowStart: Date;
  windowEnd: Date;
}

const COUNTED_STATUSES = new Set([
  'SUBMITTED',
  'PROCESSING',
  'NEEDS_INFO',
  'IN_REVIEW',
  'APPROVED',
  'PAID',
]);

/**
 * Pure, tenant-scoped anomaly detection over cases-owned snapshots. Rejected/closed cases and
 * non-claim case types are excluded by the caller. All findings are review signals, never denials.
 */
export function detectAnomalies(
  tenantId: string,
  observations: AnomalyObservation[],
  now: Date,
  thresholds: AnomalyThresholds = DEFAULT_ANOMALY_THRESHOLDS,
  candidateGroups?: AnomalyCandidateGroups,
): AnomalySignal[] {
  const rows = observations.filter(
    (row) => row.tenantId === tenantId && COUNTED_STATUSES.has(row.status) && row.createdAt <= now,
  );
  const results: AnomalySignal[] = [];
  const isCandidate = (type: AnomalyType, key: string) =>
    candidateGroups?.[type] === undefined || candidateGroups[type]!.has(key);

  const payoutGroups = group(
    rows.filter((row) => row.payoutKey),
    (row) => row.payoutKey!,
  );
  for (const [key, items] of payoutGroups) {
    if (!isCandidate('shared_payout', key)) continue;
    const scoped = within(items, now, ANOMALY_WINDOWS.sharedPayoutMs);
    const people = distinctPeople(scoped);
    if (people.size > thresholds.sharedPayoutPeople) {
      results.push(
        signal(
          'shared_payout',
          key,
          scoped,
          people.size,
          thresholds.sharedPayoutPeople,
          now,
          ANOMALY_WINDOWS.sharedPayoutMs,
        ),
      );
    }
  }

  const helperGroups = group(
    rows.filter((row) => row.helperId),
    (row) => row.helperId!,
  );
  for (const [key, items] of helperGroups) {
    if (!isCandidate('helper_velocity', key)) continue;
    const scoped = within(items, now, ANOMALY_WINDOWS.helperVelocityMs);
    // Distinct people, not claims: a helper who retries or re-files for the same family is not a ring.
    const count = distinctPeople(scoped).size;
    if (count > thresholds.helperClaimsPerHour) {
      results.push(
        signal(
          'helper_velocity',
          key,
          scoped,
          count,
          thresholds.helperClaimsPerHour,
          now,
          ANOMALY_WINDOWS.helperVelocityMs,
        ),
      );
    }
  }

  const householdGroups = group(
    rows.filter((row) => row.district && row.householdSize !== null),
    (row) => `${normalize(row.district!)}\u0000${row.householdSize}`,
  );
  for (const [key, items] of householdGroups) {
    if (!isCandidate('household_pattern', key)) continue;
    const scoped = within(items, now, ANOMALY_WINDOWS.householdPatternMs);
    const people = distinctPeople(scoped);
    if (people.size >= thresholds.householdPatternPeople) {
      results.push(
        signal(
          'household_pattern',
          key,
          scoped,
          people.size,
          thresholds.householdPatternPeople,
          now,
          ANOMALY_WINDOWS.householdPatternMs,
        ),
      );
    }
  }

  const identityGroups = group(
    rows.filter((row) => row.district && row.nameNormalized),
    (row) => `${normalize(row.nameNormalized)}\u0000${normalize(row.district!)}`,
  );
  for (const [key, items] of identityGroups) {
    if (!isCandidate('identity_collision', key)) continue;
    const scoped = within(items, now, ANOMALY_WINDOWS.identityCollisionMs);
    const participating = new Set<string>();
    for (let i = 0; i < scoped.length; i++) {
      for (let j = i + 1; j < scoped.length; j++) {
        const left = scoped[i]!;
        const right = scoped[j]!;
        if (left.cnicHash === right.cnicHash) continue;
        const corroboration =
          Number(!!left.payoutKey && left.payoutKey === right.payoutKey) +
          Number(!!left.helperId && left.helperId === right.helperId) +
          Number(left.householdSize !== null && left.householdSize === right.householdSize);
        if (corroboration >= thresholds.identityCorroboratingDetails) {
          participating.add(left.caseId);
          participating.add(right.caseId);
        }
      }
    }
    if (participating.size) {
      const matched = scoped.filter((row) => participating.has(row.caseId));
      results.push(
        signal(
          'identity_collision',
          key,
          matched,
          new Set(matched.map((row) => row.cnicHash)).size,
          thresholds.identityCorroboratingDetails,
          now,
          ANOMALY_WINDOWS.identityCollisionMs,
        ),
      );
    }
  }

  return results.sort(
    (a, b) => a.type.localeCompare(b.type) || a.groupKey.localeCompare(b.groupKey),
  );
}

/**
 * Submit-path check for one claim. `observations` are only the rows that share a key with the claim
 * (same payout key, helper, district + household size, or name + district), fetched with indexed
 * lookups, so every group the claim belongs to is complete and nothing else has to be scanned.
 */
export function detectAnomaliesForCase(
  tenantId: string,
  caseId: string,
  observations: AnomalyObservation[],
  now: Date,
  thresholds: AnomalyThresholds = DEFAULT_ANOMALY_THRESHOLDS,
): AnomalySignal[] {
  const unique = [...new Map(observations.map((row) => [row.caseId, row])).values()];
  return detectAnomalies(tenantId, unique, now, thresholds).filter((found) =>
    found.evidenceCaseIds.includes(caseId),
  );
}

function signal(
  type: AnomalyType,
  groupKey: string,
  rows: AnomalyObservation[],
  observedCount: number,
  threshold: number,
  now: Date,
  windowMs: number,
): AnomalySignal {
  return {
    type,
    groupKey,
    evidenceCaseIds: [...new Set(rows.map((row) => row.caseId))].sort(),
    observedCount,
    threshold,
    windowStart: new Date(now.getTime() - windowMs),
    windowEnd: now,
  };
}

function group<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const items = result.get(key) ?? [];
    items.push(row);
    result.set(key, items);
  }
  return result;
}

function within(rows: AnomalyObservation[], now: Date, windowMs: number) {
  const cutoff = now.getTime() - windowMs;
  return rows.filter((row) => row.createdAt.getTime() >= cutoff);
}

function distinctPeople(rows: AnomalyObservation[]) {
  return new Set(rows.map((row) => row.cnicHash));
}

function normalize(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}
