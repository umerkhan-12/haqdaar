import { createHash } from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);

/** The fields that are hashed. `seq` and `recordedAt` are storage details, not evidence. */
export interface ChainFields {
  eventId: string;
  type: string;
  source: string;
  tenantId: string | null;
  actor: unknown;
  entityId: string | null;
  payload: unknown;
  occurredAt: string;
}

export interface ChainRow extends ChainFields {
  seq: number;
  prevHash: string;
  hash: string;
}

/** JSON with object keys sorted at every level, so jsonb key reordering never changes a hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/** Only the chain fields are hashed, even if a full row (with seq/hash) is passed in. */
export function chainHash(fields: ChainFields, prevHash: string): string {
  return createHash('sha256')
    .update(canonicalJson({ ...fieldsOf(fields), prevHash }))
    .digest('hex');
}

const ENTITY_KEYS = ['caseId', 'paymentId', 'consentId', 'personId', 'userId'] as const;

/** The main thing an event is about, for "show me everything that happened to case X". */
export function entityIdOf(payload: Record<string, unknown>): string | null {
  for (const k of ENTITY_KEYS) {
    const v = payload[k];
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

export type VerifyResult =
  | { valid: true; checked: number; lastSeq: number | null; lastHash: string }
  | {
      valid: false;
      checked: number;
      brokenAtSeq: number;
      reason: 'prev_hash_mismatch' | 'hash_mismatch';
      expectedHash: string;
      foundHash: string;
    };

/**
 * Verify rows (ascending seq) against the expected previous hash.
 * Detects edited rows (hash_mismatch) and deleted/reordered rows (prev_hash_mismatch).
 */
export function verifyRows(rows: ChainRow[], expectedPrev: string): VerifyResult {
  let prev = expectedPrev;
  let checked = 0;
  for (const row of rows) {
    if (row.prevHash !== prev) {
      return {
        valid: false,
        checked,
        brokenAtSeq: row.seq,
        reason: 'prev_hash_mismatch',
        expectedHash: prev,
        foundHash: row.prevHash,
      };
    }
    const expected = chainHash(row, row.prevHash);
    if (expected !== row.hash) {
      return {
        valid: false,
        checked,
        brokenAtSeq: row.seq,
        reason: 'hash_mismatch',
        expectedHash: expected,
        foundHash: row.hash,
      };
    }
    prev = row.hash;
    checked += 1;
  }
  return { valid: true, checked, lastSeq: rows.at(-1)?.seq ?? null, lastHash: prev };
}

export function fieldsOf(r: ChainFields): ChainFields {
  return {
    eventId: r.eventId,
    type: r.type,
    source: r.source,
    tenantId: r.tenantId,
    actor: r.actor,
    entityId: r.entityId,
    payload: r.payload,
    occurredAt: r.occurredAt,
  };
}
