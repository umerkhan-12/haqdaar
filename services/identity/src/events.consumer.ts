import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus } from '@haqdaar/nest-kit';
import { EventSchemas, type EventEnvelope } from '@haqdaar/shared';
import { PrismaService } from './prisma.service';

/**
 * AI usage per tenant. Idempotent: the event id is recorded in the same transaction as the count.
 *
 * Gap: the ai service publishes `ai.call.completed` without a principal, so `tenantId` is null
 * today and these events are skipped. Attribution starts as soon as ai passes the caller
 * (`buildEvent(..., { source: 'ai', principal })`); until then per-tenant AI usage is visible as
 * gateway requests to the `ai` service in the same report.
 */
@Injectable()
export class EventsConsumer implements OnModuleInit {
  private readonly logger = new Logger(EventsConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
  ) {}

  async onModuleInit() {
    await this.bus.subscribe('ai.call.completed', (e) => this.onAiCall(e), 'usage');
  }

  private async onAiCall(e: EventEnvelope) {
    if (!e.tenantId) return;
    const p = EventSchemas['ai.call.completed'].parse(e.payload);
    const key = { tenantId: e.tenantId, day: new Date(`${e.occurredAt.slice(0, 10)}T00:00:00Z`) };
    const inc = { calls: 1, failures: p.ok ? 0 : 1, fallbacks: p.fallbackUsed ? 1 : 0 };
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.processedEvent.create({ data: { eventId: e.eventId, type: e.type } });
        await tx.aiUsageDaily.upsert({
          where: { tenantId_day: key },
          create: { ...key, ...inc },
          update: {
            calls: { increment: inc.calls },
            failures: { increment: inc.failures },
            fallbacks: { increment: inc.fallbacks },
          },
        });
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') return; // already processed
      this.logger.error({ err, eventId: e.eventId }, 'AI usage event failed');
      throw err;
    }
  }
}
