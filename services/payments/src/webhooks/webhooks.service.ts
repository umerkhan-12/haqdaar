import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import type { EventEnvelope } from '@haqdaar/shared';
import type { WebhookDelivery } from '../../generated/prisma';
import { PrismaService } from '../prisma.service';
import { env } from '../env';
import { backoffMs, signWebhook } from '../domain/webhook-signature';

const MAX_ATTEMPTS = 6;
const TIMEOUT_MS = 5_000;
const SWEEP_EVERY_MS = 10_000;

/**
 * Signed partner webhooks. Delivery rows are created once per (subscription, event) — the bus
 * may redeliver an event, the unique constraint makes that a no-op. Failed deliveries retry with
 * backoff and can be resent by hand; every attempt is logged.
 */
@Injectable()
export class WebhooksService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WebhooksService.name);
  private sweeper?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.sweeper = setInterval(() => void this.retryDue(), SWEEP_EVERY_MS);
    this.sweeper.unref();
  }

  onApplicationShutdown() {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  create(tenantId: string, url: string, events: string[], createdBy: string) {
    return this.prisma.webhookSubscription.create({ data: { tenantId, url, events, createdBy } });
  }

  list(tenantId: string) {
    return this.prisma.webhookSubscription.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deliveries(tenantId: string, subscriptionId: string) {
    await this.ownSubscription(tenantId, subscriptionId);
    return this.prisma.webhookDelivery.findMany({
      where: { subscriptionId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async resend(tenantId: string, deliveryId: string) {
    const d = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, subscription: { tenantId } },
    });
    if (!d) throw new NotFoundException('Delivery not found');
    const reset = await this.prisma.webhookDelivery.update({
      where: { id: d.id },
      data: { status: 'PENDING', nextAttemptAt: new Date() },
    });
    return this.deliver(reset);
  }

  async dispatch(event: EventEnvelope) {
    if (!event.tenantId) return;
    const subs = await this.prisma.webhookSubscription.findMany({
      where: { tenantId: event.tenantId, active: true, events: { has: event.type } },
    });
    for (const s of subs) {
      const d = await this.prisma.webhookDelivery
        .create({
          data: {
            subscriptionId: s.id,
            eventId: event.eventId,
            eventType: event.type,
            payload: event as object,
          },
        })
        .catch((err: { code?: string }) => {
          if (err.code === 'P2002') return null; // already queued for this event
          throw err;
        });
      if (d) await this.deliver(d);
    }
  }

  private async deliver(d: WebhookDelivery): Promise<WebhookDelivery> {
    const sub = await this.prisma.webhookSubscription.findUniqueOrThrow({
      where: { id: d.subscriptionId },
    });
    const body = JSON.stringify(d.payload);
    const attempts = d.attempts + 1;
    let statusCode: number | null = null;
    let error: string | null = null;
    try {
      const res = await fetch(sub.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-haqdaar-signature': signWebhook(body, env.WEBHOOK_SIGNING_SECRET),
          'x-haqdaar-event': d.eventType,
          'x-haqdaar-delivery': d.id,
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      statusCode = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (err) {
      error = (err as Error).message.slice(0, 200);
    }

    const delivered = !error;
    if (!delivered)
      this.logger.warn({ deliveryId: d.id, attempts, error }, 'Webhook delivery failed');
    return this.prisma.webhookDelivery.update({
      where: { id: d.id },
      data: {
        attempts,
        lastStatusCode: statusCode,
        lastError: error,
        status: delivered ? 'DELIVERED' : attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
        deliveredAt: delivered ? new Date() : null,
        nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
      },
    });
  }

  private async retryDue() {
    const due = await this.prisma.webhookDelivery
      .findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } }, take: 20 })
      .catch(() => []);
    for (const d of due) await this.deliver(d).catch(() => undefined);
  }

  private async ownSubscription(tenantId: string, id: string) {
    const s = await this.prisma.webhookSubscription.findFirst({ where: { id, tenantId } });
    if (!s) throw new NotFoundException('Webhook not found');
    return s;
  }
}
