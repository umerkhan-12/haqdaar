import { randomUUID } from 'node:crypto';
import { EventSchemas, type EventEnvelope, type EventPayload, type EventType } from '@haqdaar/shared';
import type { Principal } from '../auth/decorators';

export interface EventContext {
  source: string;
  tenantId?: string | null;
  principal?: Principal | null;
  correlationId?: string | null;
}

/** Build a validated event envelope. Invalid payloads throw before anything is saved. */
export function buildEvent<T extends EventType>(
  type: T,
  payload: EventPayload<T>,
  ctx: EventContext,
): EventEnvelope<EventPayload<T>> {
  const parsed = EventSchemas[type].parse(payload) as EventPayload<T>;
  const p = ctx.principal;
  return {
    eventId: randomUUID(),
    type,
    occurredAt: new Date().toISOString(),
    source: ctx.source,
    tenantId: ctx.tenantId ?? (p?.kind === 'user' ? p.tenantId : null),
    actor: p
      ? p.kind === 'user'
        ? { id: p.id, role: p.role, onBehalfOf: p.onBehalfOf ?? null }
        : { id: `service:${p.service}`, role: 'service' }
      : null,
    correlationId: ctx.correlationId ?? null,
    payload: parsed,
  };
}

/**
 * Row data for the service's own `outbox` table (Prisma model `OutboxEvent`).
 * Write it in the SAME transaction as the business change.
 */
export function outboxRow(envelope: EventEnvelope) {
  return { id: envelope.eventId, type: envelope.type, envelope: envelope as object };
}
