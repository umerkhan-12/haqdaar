import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus } from '@haqdaar/nest-kit';
import type { EventEnvelope, EventPayload } from '@haqdaar/shared';
import { PayoutService } from './payments/payout.service';
import { WebhooksService } from './webhooks/webhooks.service';
import { ReceiptsService } from './receipts/receipts.service';

/**
 * Every event this service consumes, registered in sequence (pg-boss queue creation must not
 * run concurrently). Handlers are idempotent: the bus can deliver an event more than once.
 */
@Injectable()
export class EventsConsumer implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly payouts: PayoutService,
    private readonly webhooks: WebhooksService,
    private readonly receipts: ReceiptsService,
  ) {}

  async onModuleInit() {
    await this.bus.subscribe('cases.case.decided', (e) =>
      this.payouts.onCaseDecided(e as EventEnvelope<EventPayload<'cases.case.decided'>>),
    );
    await this.bus.subscribe('payments.payment.state_changed', (e) => this.webhooks.dispatch(e));
    await this.bus.subscribe(
      'payments.payment.state_changed',
      (e) => this.receipts.onStateChanged(e as EventEnvelope<EventPayload<'payments.payment.state_changed'>>),
      'receipts',
    );
  }
}
