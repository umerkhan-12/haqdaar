import { Injectable } from '@nestjs/common';
import { DemoResetter } from '@haqdaar/nest-kit';
import { PrismaService } from './prisma.service';

/** Clears payouts, ledger and reconciliation runs. Webhook subscriptions (configuration) stay. */
@Injectable()
export class PaymentsDemoReset extends DemoResetter {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async reset() {
    const payments = await this.prisma.payment.count();
    await this.prisma.$transaction([
      this.prisma.$executeRawUnsafe(
        'TRUNCATE payments, payment_transitions, payment_attempts, ledger_entries, approvals, reconciliation_runs, webhook_deliveries CASCADE',
      ),
      this.prisma.outboxEvent.deleteMany({ where: { publishedAt: { not: null } } }),
    ]);
    return { payments };
  }
}
