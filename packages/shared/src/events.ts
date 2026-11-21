import { z } from 'zod';
import { CaseStatus, Lane, PaymentState, TenantType } from './domain';

/** Every event on the bus is wrapped in this envelope. */
export const EventEnvelope = z.object({
  eventId: z.string().uuid(),
  type: z.string(),
  occurredAt: z.string().datetime(),
  source: z.string(),
  tenantId: z.string().nullable(),
  actor: z
    .object({ id: z.string(), role: z.string(), onBehalfOf: z.string().nullish() })
    .nullable(),
  correlationId: z.string().nullish(),
  payload: z.record(z.unknown()),
});
export type EventEnvelope<P = Record<string, unknown>> = Omit<
  z.infer<typeof EventEnvelope>,
  'payload'
> & { payload: P };

/** Event names and payload schemas. Producers and consumers both validate against these. */
export const EventSchemas = {
  'identity.user.logged_in': z.object({ userId: z.string() }),
  /** A citizen created their own account (phone verified by a one-time code). */
  'identity.user.registered': z.object({ userId: z.string(), personId: z.string() }),
  /** A platform admin launched a new program (tenant) with its first admin user. */
  'identity.tenant.created': z.object({
    tenantId: z.string().uuid(),
    name: z.string(),
    type: TenantType,
    adminUserId: z.string().uuid(),
  }),
  'identity.consent.granted': z.object({
    consentId: z.string(),
    personId: z.string(),
    purpose: z.string(),
  }),
  'identity.consent.withdrawn': z.object({
    consentId: z.string(),
    personId: z.string(),
    purpose: z.string(),
  }),
  /** A citizen says a stored fact about her is wrong; an officer corrects it after checking (never self-edit). */
  'identity.correction.requested': z.object({
    personId: z.string(),
    field: z.string(),
    note: z.string().nullable(),
  }),
  'cases.case.submitted': z.object({
    caseId: z.string(),
    personId: z.string(),
    type: z.string(),
    /** Redacted summary of the AI notes sent with the claim (no names, masked CNICs, no transcript text). */
    aiNotes: z.record(z.unknown()).optional(),
  }),
  'cases.case.status_changed': z.object({
    caseId: z.string(),
    from: CaseStatus.nullable(),
    to: CaseStatus,
    /** Officer case-management steps that are not a plain status move: `escalated`, `closed`, `assigned`. */
    action: z.string().max(40).optional(),
    note: z.string().max(500).optional(),
  }),
  'cases.case.decided': z.object({
    caseId: z.string(),
    personId: z.string(),
    lane: Lane,
    confidence: z.number(),
    ruleVersionId: z.string(),
    amount: z.number().nullable(),
  }),
  'cases.rule.published': z.object({
    ruleVersionId: z.string(),
    version: z.number().int(),
    previousVersionId: z.string().nullable(),
  }),
  'payments.payment.state_changed': z.object({
    paymentId: z.string(),
    caseId: z.string(),
    from: PaymentState.nullable(),
    to: PaymentState,
    amount: z.number(),
    reason: z.string().nullish(),
  }),
  'ai.call.completed': z.object({
    task: z.string(),
    provider: z.string(),
    model: z.string(),
    latencyMs: z.number(),
    ok: z.boolean(),
    fallbackUsed: z.boolean(),
  }),
  'ai.kill_switch.changed': z.object({ killed: z.boolean() }),
  'judge.scenario.ran': z.object({
    scenarioId: z.string(),
    ok: z.boolean(),
    durationMs: z.number(),
  }),
  'judge.demo.reset': z.object({ services: z.array(z.string()) }),
} as const;

export type EventType = keyof typeof EventSchemas;
export type EventPayload<T extends EventType> = z.infer<(typeof EventSchemas)[T]>;

export const ALL_EVENT_TYPES = Object.keys(EventSchemas) as EventType[];
