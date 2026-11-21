import { Injectable, Logger } from '@nestjs/common';
import { sealMessage, ServiceClient } from '@haqdaar/nest-kit';
import type { EventEnvelope, EventPayload } from '@haqdaar/shared';
import { PrismaService } from '../prisma.service';
import { env } from '../env';
import { receiptText } from './receipt';

const SEAL_VALID_DAYS = 30;

/**
 * Sends the Haq Receipt once per successful payout: a sealed SMS with the exact amount.
 * Exactly-once: the payment row is claimed (receipt_sent_at) before sending; if the send fails
 * the claim is released and the event is retried by the bus.
 */
@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: ServiceClient,
  ) {}

  async onStateChanged(e: EventEnvelope<EventPayload<'payments.payment.state_changed'>>): Promise<void> {
    if (e.payload.to !== 'SUCCESS') return;
    const p = await this.prisma.payment.findUnique({ where: { id: e.payload.paymentId } });
    if (!p?.creditorAlias || p.receiptSentAt) return;

    const claimed = await this.prisma.payment.updateMany({
      where: { id: p.id, receiptSentAt: null },
      data: { receiptSentAt: new Date() },
    });
    if (claimed.count === 0) return;

    const body = sealMessage(
      receiptText(p.amount, p.providerRef),
      env.SEAL_SECRET,
      new Date(Date.now() + SEAL_VALID_DAYS * 86_400_000),
    );
    try {
      await this.client.call('rails-mock', '/mock/sms/send', {
        method: 'POST',
        body: { to: p.creditorAlias, body },
        retries: 0,
      });
    } catch (err) {
      await this.prisma.payment.update({ where: { id: p.id }, data: { receiptSentAt: null } });
      this.logger.warn({ err, paymentId: p.id }, 'Haq Receipt not sent, will retry');
      throw err;
    }
  }
}
