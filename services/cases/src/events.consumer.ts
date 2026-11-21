import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { buildEvent, EventBus, outboxRow } from '@haqdaar/nest-kit';
import { DEFAULT_COSTS, EventSchemas, type EventEnvelope } from '@haqdaar/shared';
import { Prisma } from '../generated/prisma';
import { PrismaService } from './prisma.service';
import { combinedLogic, SAHARA_V1 } from './engine/rules';

/** Idempotent consumers: each event id is recorded in the same transaction as its effect. */
@Injectable()
export class EventsConsumer implements OnModuleInit {
  private readonly logger = new Logger(EventsConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
  ) {}

  async onModuleInit() {
    await this.bus.subscribe('payments.payment.state_changed', (e) =>
      this.once(e, (tx) => this.onPayment(tx, e)),
    );
    await this.bus.subscribe('identity.consent.withdrawn', (e) =>
      this.once(e, (tx) => this.onConsentWithdrawn(tx, e)),
    );
    await this.bus.subscribe('identity.tenant.created', (e) =>
      this.once(e, (tx) => this.onTenantCreated(tx, e)),
    );
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

  /**
   * A freshly launched program can take claims at once: published rule v1 (a copy of the Sahara
   * template, which its admin can then edit and republish) and default cost settings.
   * Never overwrites: a tenant that already has rules or costs keeps them.
   */
  private async onTenantCreated(tx: Prisma.TransactionClient, e: EventEnvelope) {
    const p = EventSchemas['identity.tenant.created'].parse(e.payload);
    const tenantId = p.tenantId;
    if (!(await tx.ruleVersion.findFirst({ where: { tenantId }, select: { id: true } }))) {
      const rule = await tx.ruleVersion.create({
        data: {
          tenantId,
          version: 1,
          status: 'PUBLISHED',
          clauses: SAHARA_V1.clauses as object[],
          logic: combinedLogic(SAHARA_V1.clauses) as object,
          amount: SAHARA_V1.amount,
          notes: `${p.name}: v1 from the Sahara template.`,
          createdBy: 'service:onboarding',
          publishedBy: 'service:onboarding',
          publishedAt: new Date(),
        },
      });
      await tx.outboxEvent.create({
        data: outboxRow(
          buildEvent(
            'cases.rule.published',
            { ruleVersionId: rule.id, version: 1, previousVersionId: null },
            { source: 'cases', tenantId, correlationId: e.correlationId },
          ),
        ),
      });
    }
    await tx.costSettings.upsert({
      where: { tenantId },
      update: {},
      create: { tenantId, ...DEFAULT_COSTS, updatedBy: 'service:onboarding' },
    });
    this.logger.log({ tenantId }, 'Program onboarded: rule v1 published, default costs set');
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
        await tx.case.update({
          where: { id: c.id },
          data: { flags: { push: 'consent_withdrawn' } },
        });
      }
      await tx.caseEvent.create({
        data: {
          caseId: c.id,
          type: 'consent_withdrawn',
          actor: 'service:identity',
          data: { purpose: p.purpose },
        },
      });
    }
  }
}
