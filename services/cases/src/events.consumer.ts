import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { buildEvent, EventBus, outboxRow } from '@haqdaar/nest-kit';
import { EventSchemas, type EventEnvelope } from '@haqdaar/shared';
import { Prisma } from '../generated/prisma';
import { PrismaService } from './prisma.service';

/** Idempotent consumers: each event id is recorded in the same transaction as its effect. */
@Injectable()
export class EventsConsumer implements OnModuleInit {
  private readonly logger = new Logger(EventsConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
  ) {}

  async onModuleInit() {
    await this.bus.subscribe('payments.payment.state_changed', (e) => this.once(e, (tx) => this.onPayment(tx, e)));
    await this.bus.subscribe('identity.consent.withdrawn', (e) => this.once(e, (tx) => this.onConsentWithdrawn(tx, e)));
  }

  private async once(e: EventEnvelope, handle: (tx: Prisma.TransactionClient) => Promise<void>) {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.processedEvent.create({ data: { eventId: e.eventId, type: e.type } });
        await handle(tx);
      });
      this.bus.kick();
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') return; // already processed
      this.logger.error({ err, eventId: e.eventId, type: e.type }, 'Event handling failed');
      throw err; // pg-boss retries with backoff, then dead-letters
    }
  }

  private async onPayment(tx: Prisma.TransactionClient, e: EventEnvelope) {
    const p = EventSchemas['payments.payment.state_changed'].parse(e.payload);
    const c = await tx.case.findUnique({ where: { id: p.caseId } });
    if (!c) return this.logger.warn({ caseId: p.caseId }, 'Payment event for unknown case');

    await tx.caseEvent.create({
      data: {
        caseId: c.id,
        type: `payment.${p.to.toLowerCase()}`,
        actor: 'service:payments',
        data: { paymentId: p.paymentId, amount: p.amount, reason: p.reason ?? null },
      },
    });
    if (p.to === 'SUCCESS' && c.status === 'APPROVED') {
      await tx.case.update({ where: { id: c.id }, data: { status: 'PAID' } });
      await tx.outboxEvent.create({
        data: outboxRow(
          buildEvent(
            'cases.case.status_changed',
            { caseId: c.id, from: 'APPROVED', to: 'PAID' },
            { source: 'cases', tenantId: c.tenantId, correlationId: e.correlationId },
          ),
        ),
      });
    }
  }

  /** Flag open cases; staff reads are blocked by the live consent check, not by this flag. */
  private async onConsentWithdrawn(tx: Prisma.TransactionClient, e: EventEnvelope) {
    const p = EventSchemas['identity.consent.withdrawn'].parse(e.payload);
    const open = await tx.case.findMany({
      where: { personId: p.personId, status: { notIn: ['REJECTED', 'PAID', 'CLOSED'] } },
      select: { id: true, flags: true },
    });
    for (const c of open) {
      if (!c.flags.includes('consent_withdrawn')) {
        await tx.case.update({ where: { id: c.id }, data: { flags: { push: 'consent_withdrawn' } } });
      }
      await tx.caseEvent.create({
        data: { caseId: c.id, type: 'consent_withdrawn', actor: 'service:identity', data: { purpose: p.purpose } },
      });
    }
  }
}
