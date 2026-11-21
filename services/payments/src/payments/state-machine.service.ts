import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { buildEvent, EventBus, outboxRow, type Principal } from '@haqdaar/nest-kit';
import type { PaymentState } from '@haqdaar/shared';
import { Prisma, type Payment } from '../../generated/prisma';
import { PrismaService } from '../prisma.service';
import { transitionError } from '../domain/transition';
import { payoutLines, reversalLines, type LedgerLine } from '../domain/ledger';

export type Tx = Prisma.TransactionClient;

export const SYSTEM: Principal = { kind: 'service', service: 'payments' };

export const actorId = (p: Principal) => (p.kind === 'user' ? p.id : 'system');

export interface TransitionOptions {
  reason?: string;
  by?: Principal;
  /** Extra columns to set together with the state change. */
  patch?: Prisma.PaymentUpdateManyMutationInput;
  /** Book ledger lines in the same transaction (SUCCESS / REVERSED). */
  ledger?: 'PAYOUT' | 'REVERSAL';
}

/**
 * The ONLY way a payment changes state:
 *  1. state machine check (canTransition)
 *  2. optimistic lock: `UPDATE ... WHERE id = ? AND version = ?` — a concurrent writer loses with 409
 *  3. transition row + ledger lines + outbox event, all in one database transaction
 */
@Injectable()
export class PaymentStateMachine {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
  ) {}

  async transition(
    payment: Payment,
    to: PaymentState,
    o: TransitionOptions = {},
  ): Promise<Payment> {
    const updated = await this.prisma.$transaction((tx) => this.transitionIn(tx, payment, to, o));
    this.bus.kick();
    return updated;
  }

  async transitionIn(
    tx: Tx,
    payment: Payment,
    to: PaymentState,
    o: TransitionOptions,
  ): Promise<Payment> {
    const from = payment.state as PaymentState;
    const illegal = transitionError(from, to);
    if (illegal) throw new ConflictException(illegal);

    const by = o.by ?? SYSTEM;
    // A held payment always says why, on the payment itself (officers read it in the queue).
    const holdReason = to === 'HELD' ? { holdReason: o.reason ?? 'UNSPECIFIED' } : {};
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, version: payment.version },
      data: { ...o.patch, ...holdReason, state: to, version: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw new ConflictException('Payment was changed by another request. Reload and try again.');
    }

    await tx.paymentTransition.create({
      data: { paymentId: payment.id, from, to, reason: o.reason, actor: actorId(by) },
    });

    if (o.ledger) {
      const lines: LedgerLine[] =
        o.ledger === 'PAYOUT' ? payoutLines(payment.amount) : reversalLines(payment.amount);
      const entryGroupId = randomUUID();
      await tx.ledgerEntry.createMany({
        data: lines.map((l) => ({ ...l, paymentId: payment.id, entryGroupId, kind: o.ledger! })),
      });
    }

    const event = buildEvent(
      'payments.payment.state_changed',
      {
        paymentId: payment.id,
        caseId: payment.caseId,
        from,
        to,
        amount: payment.amount,
        reason: o.reason ?? null,
      },
      { source: 'payments', tenantId: payment.tenantId, principal: by },
    );
    await tx.outboxEvent.create({ data: outboxRow(event) });

    return tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }

  async get(id: string, tenantId?: string): Promise<Payment> {
    const p = await this.prisma.payment.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!p) throw new NotFoundException('Payment not found');
    return p;
  }
}
