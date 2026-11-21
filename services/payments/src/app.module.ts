import { Module } from '@nestjs/common';
import { EventBusModule, KitModule } from '@haqdaar/nest-kit';
import { env } from './env';
import { PrismaService } from './prisma.service';
import { PaymentStateMachine } from './payments/state-machine.service';
import { PayoutService } from './payments/payout.service';
import { RailsClient } from './payments/rails.client';
import { PaymentsController } from './payments/payments.controller';
import { LedgerController } from './ledger/ledger.controller';
import { ReconciliationController } from './reconciliation/reconciliation.controller';
import { WebhooksController } from './webhooks/webhooks.controller';
import { WebhooksService } from './webhooks/webhooks.service';
import { EventsConsumer } from './events.consumer';

@Module({
  imports: [
    KitModule.forRoot({
      service: 'payments',
      jwtPublicKey: env.JWT_PUBLIC_KEY,
      internalSecret: env.INTERNAL_SECRET,
      logLevel: env.LOG_LEVEL,
      prettyLogs: env.LOG_PRETTY === '1',
    }),
    EventBusModule.forRoot({
      service: 'payments',
      busUrl: env.BUS_DATABASE_URL,
      outboxDatabaseUrl: env.PAYMENTS_DATABASE_URL,
    }),
  ],
  controllers: [PaymentsController, LedgerController, ReconciliationController, WebhooksController],
  providers: [
    PrismaService,
    PaymentStateMachine,
    RailsClient,
    PayoutService,
    WebhooksService,
    EventsConsumer,
  ],
})
export class AppModule {}
