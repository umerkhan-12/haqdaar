import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import type { AuthUser, Principal } from '@haqdaar/nest-kit';
import type { EventEnvelope, EventPayload } from '@haqdaar/shared';
import type { Payment } from '../../generated/prisma';
import { PrismaService } from '../prisma.service';
import { env } from '../env';
import { nameMatchScore, TITLE_MATCH_THRESHOLD } from '../domain/name-match';
import { velocityBreached } from '../domain/velocity';
import { newEndToEndId } from '../domain/transition';
import { RailsClient } from './rails.client';
import { PaymentStateMachine, SYSTEM } from './state-machine.service';

const INQUIRY_DELAY_MS = 2_000;
const SWEEP_EVERY_MS = 15_000;

/**
 * Payout orchestration. Invariants:
 *  - one payout per case (idempotency key `case:<id>`, unique in DB)
 *  - one endToEndId per payout, reused on every retry, so the provider can dedupe
 *  - a lost response (timeout) becomes UNKNOWN and is settled ONLY by a status inquiry
 *  - large payouts, released holds and reversals need a second, different person
 */
@Injectable()
export class PayoutService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PayoutService.name);
  private sweeper?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sm: PaymentStateMachine,
    private readonly rails: RailsClient,
  ) {}

  onModuleInit() {
    this.sweeper = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.sweeper.unref();
  }

  onApplicationShutdown() {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  // ---------- intake ----------

  async onCaseDecided(e: EventEnvelope<EventPayload<'cases.case.decided'>>) {
    const { caseId, amount } = e.payload;
    if (!amount || amount <= 0) return;
    if (await this.prisma.payment.findUnique({ where: { caseId } })) return; // redelivery: no-op

    const d = await this.rails.payoutDetails(caseId);
    let payment: Payment;
    try {
      payment = await this.prisma.$transaction(async (tx) => {
        const p = await tx.payment.create({
          data: {
            tenantId: d.tenantId,
            caseId,
            personId: d.personId,
            amount: d.amount,
            idempotencyKey: `case:${caseId}`,
            endToEndId: newEndToEndId(),
            creditorName: d.beneficiaryName,
            creditorIban: d.accountIban,
            creditorAlias: d.accountAlias,
          },
        });
        await tx.paymentTransition.create({
          data: {
            paymentId: p.id,
            from: null,
            to: 'CREATED',
            reason: 'CASE_APPROVED',
            actor: 'system',
          },
        });
        return p;
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') return; // concurrent duplicate lost the race
      throw err;
    }
    await this.screen(payment);
  }

  /** Title fetch + name match, velocity, maker-checker limit. Then auto-approve or wait for a human. */
  private async screen(payment: Payment) {
    let title;
    try {
      title = await this.rails.titleFetch(
        payment.creditorIban ? { iban: payment.creditorIban } : { alias: payment.creditorAlias! },
      );
    } catch {
      return this.sm.transition(payment, 'HELD', { reason: 'TITLE_FETCH_UNAVAILABLE' });
    }
    if (!title.found || !title.accountTitle) {
      return this.sm.transition(payment, 'HELD', { reason: 'ACCOUNT_NOT_FOUND' });
    }

    const score = nameMatchScore(payment.creditorName, title.accountTitle);
    const facts = {
      titleFetched: title.accountTitle,
      titleMatchScore: score,
      creditorIban: payment.creditorIban ?? title.iban,
    };
    if (score < TITLE_MATCH_THRESHOLD) {
      return this.sm.transition(payment, 'HELD', { reason: 'TITLE_MISMATCH', patch: facts });
    }

    const recent = await this.prisma.payment.findMany({
      where: {
        id: { not: payment.id },
        createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) },
        OR: [
          ...(facts.creditorIban ? [{ creditorIban: facts.creditorIban }] : []),
          ...(payment.creditorAlias ? [{ creditorAlias: payment.creditorAlias }] : []),
        ],
      },
      select: { personId: true, createdAt: true },
    });
    if (velocityBreached(payment.personId, recent, new Date())) {
      return this.sm.transition(payment, 'HELD', { reason: 'VELOCITY', patch: facts });
    }

    const awaiting = await this.sm.transition(payment, 'AWAITING_APPROVAL', {
      reason:
        payment.amount > env.MAKER_CHECKER_LIMIT_PKR
          ? 'ABOVE_MAKER_CHECKER_LIMIT'
          : 'SCREENING_PASSED',
      patch: facts,
    });
    if (awaiting.amount > env.MAKER_CHECKER_LIMIT_PKR) return awaiting;

    const approved = await this.sm.transition(awaiting, 'APPROVED', {
      reason: 'AUTO_APPROVED_BELOW_LIMIT',
      patch: { checkerId: 'system' },
    });
    return this.send(approved);
  }

  // ---------- human actions (maker-checker) ----------

  /** Officer clears a hold after checking it. They become the maker; someone else must approve. */
  async release(id: string, user: AuthUser, note?: string, correctedAlias?: string) {
    const p = await this.sm.get(id, user.tenantId);
    // A payout held because the account was not found or is in another name can be released to a
    // corrected number the claimant gave, but only if that account is in the claimant's own name.
    // A second officer must still approve it.
    let corrected: Record<string, unknown> = {};
    if (correctedAlias && correctedAlias !== p.creditorAlias) {
      if (p.state !== 'HELD') throw new ConflictException(`Payment is ${p.state}, not held`);
      const title = await this.rails.titleFetch({ alias: correctedAlias }).catch(() => null);
      if (!title) throw new ConflictException('The bank could not be reached. Try again shortly.');
      if (!title.found || !title.accountTitle)
        throw new ConflictException('The bank has no account for that mobile number either.');
      const score = nameMatchScore(p.creditorName, title.accountTitle);
      if (score < TITLE_MATCH_THRESHOLD)
        throw new ConflictException(
          'That account is in a different name than the claimant. The payout stays held.',
        );
      corrected = {
        creditorAlias: correctedAlias,
        creditorIban: title.iban ?? null,
        titleFetched: title.accountTitle,
        titleMatchScore: score,
      };
    }
    const why = correctedAlias && Object.keys(corrected).length ? 'PAYOUT_NUMBER_CORRECTED' : '';
    await this.prisma.approval.create({
      data: {
        paymentId: id,
        action: 'RELEASE',
        actorId: user.id,
        note: [why, note].filter(Boolean).join(': ') || undefined,
      },
    });
    return this.sm.transition(p, 'AWAITING_APPROVAL', {
      by: user,
      reason: `RELEASED: ${why || note || p.holdReason || ''}`.trim(),
      patch: { makerId: user.id, holdReason: null, ...corrected },
    });
  }

  async approve(id: string, user: AuthUser, note?: string) {
    const p = await this.sm.get(id, user.tenantId);
    if (p.makerId === user.id) {
      throw new ForbiddenException('Maker-checker: you cannot approve your own request');
    }
    await this.prisma.approval.create({
      data: { paymentId: id, action: 'APPROVE', actorId: user.id, note },
    });
    const approved = await this.sm.transition(p, 'APPROVED', {
      by: user,
      reason: 'CHECKER_APPROVED',
      patch: { checkerId: user.id },
    });
    return this.send(approved);
  }

  async requestReversal(id: string, user: AuthUser, reason: string) {
    const p = await this.sm.get(id, user.tenantId);
    await this.prisma.approval.create({
      data: { paymentId: id, action: 'REVERSAL_REQUEST', actorId: user.id, note: reason },
    });
    return this.sm.transition(p, 'REVERSAL_REQUESTED', { by: user, reason });
  }

  async approveReversal(id: string, user: AuthUser) {
    const p = await this.sm.get(id, user.tenantId);
    const request = await this.prisma.approval.findFirst({
      where: { paymentId: id, action: 'REVERSAL_REQUEST' },
      orderBy: { at: 'desc' },
    });
    if (request?.actorId === user.id) {
      throw new ForbiddenException('Maker-checker: you cannot approve your own request');
    }
    await this.prisma.approval.create({
      data: { paymentId: id, action: 'REVERSAL_APPROVE', actorId: user.id },
    });
    return this.sm.transition(p, 'REVERSED', {
      by: user,
      reason: 'REVERSAL_APPROVED',
      ledger: 'REVERSAL',
    });
  }

  /** FAILED → SENT again with the SAME endToEndId, so the provider can never pay twice. */
  async retry(id: string, user: AuthUser, correctedAlias?: string) {
    const p = await this.sm.get(id, user.tenantId);
    if (p.state !== 'FAILED')
      throw new ConflictException(`Only FAILED payments can be retried (is ${p.state})`);
    if (!correctedAlias || correctedAlias === p.creditorAlias) return this.send(p, user);

    // The claimant gave a corrected mobile account number. It is paid only if the bank has an
    // account on it AND that account is in the claimant's own name: an officer cannot redirect
    // the money to someone else.
    const title = await this.rails.titleFetch({ alias: correctedAlias }).catch(() => null);
    if (!title) throw new ConflictException('The bank could not be reached. Try again shortly.');
    if (!title.found || !title.accountTitle)
      throw new ConflictException('The bank has no account for that mobile number either.');
    const score = nameMatchScore(p.creditorName, title.accountTitle);
    if (score < TITLE_MATCH_THRESHOLD)
      throw new ConflictException(
        'That account is in a different name than the claimant. The payout was not sent.',
      );
    await this.prisma.approval.create({
      data: {
        paymentId: id,
        action: 'CORRECT_PAYOUT_NUMBER',
        actorId: user.id,
        note: 'Payout number corrected by the claimant; account title matches',
      },
    });
    return this.send(p, user, {
      creditorAlias: correctedAlias,
      creditorIban: title.iban ?? null,
      titleFetched: title.accountTitle,
      titleMatchScore: score,
    });
  }

  async inquiry(id: string, by: Principal = SYSTEM, tenantId?: string) {
    return this.settleUnknown(await this.sm.get(id, tenantId), by);
  }

  // ---------- provider ----------

  private async send(
    payment: Payment,
    by: Principal = SYSTEM,
    corrected?: {
      creditorAlias: string;
      creditorIban: string | null;
      titleFetched: string;
      titleMatchScore: number;
    },
  ): Promise<Payment> {
    if (!this.rails.canSend()) {
      this.logger.warn(
        { paymentId: payment.id },
        'Raast circuit open: payout stays APPROVED, sweeper retries',
      );
      return payment;
    }
    const sent = await this.sm.transition(payment, 'SENT', {
      by,
      reason: corrected
        ? 'RETRY_CORRECTED_PAYOUT_NUMBER'
        : payment.state === 'FAILED'
          ? 'RETRY_SAME_END_TO_END_ID'
          : 'SUBMITTED_TO_RAAST',
      ...(corrected ? { patch: corrected } : {}),
    });

    const started = Date.now();
    try {
      const r = await this.rails.transfer({
        endToEndId: sent.endToEndId,
        amount: sent.amount,
        creditor: {
          name: sent.creditorName,
          ...(sent.creditorIban ? { iban: sent.creditorIban } : { alias: sent.creditorAlias! }),
        },
      });
      await this.attempt(sent.id, 'TRANSFER', r.status, r, started);
      return r.status === 'ACSC'
        ? this.sm.transition(sent, 'SUCCESS', {
            reason: 'ACSC',
            ledger: 'PAYOUT',
            patch: { providerRef: r.providerRef, settledAt: new Date() },
          })
        : this.sm.transition(sent, 'FAILED', { reason: `RJCT: ${r.reason ?? 'rejected'}` });
    } catch (err) {
      // 4xx = provider rejected our request before processing it: nothing moved.
      if (err instanceof HttpException && err.getStatus() < 500) {
        await this.attempt(
          sent.id,
          'TRANSFER',
          'REJECTED_REQUEST',
          { error: err.message },
          started,
        );
        return this.sm.transition(sent, 'FAILED', { reason: `REQUEST_REJECTED: ${err.message}` });
      }
      // Timeout / network / 5xx: the money may or may not have moved. Never resend; ask.
      await this.attempt(
        sent.id,
        'TRANSFER',
        'NO_RESPONSE',
        { error: String((err as Error).message) },
        started,
      );
      const unknown = await this.sm.transition(sent, 'UNKNOWN', {
        reason: 'NO_RESPONSE_FROM_RAAST',
      });
      setTimeout(
        () => void this.settleUnknown(unknown).catch(() => undefined),
        INQUIRY_DELAY_MS,
      ).unref();
      return unknown;
    }
  }

  private async settleUnknown(payment: Payment, by: Principal = SYSTEM): Promise<Payment> {
    if (payment.state !== 'UNKNOWN') {
      throw new ConflictException(
        `Status inquiry is only for UNKNOWN payments (is ${payment.state})`,
      );
    }
    const started = Date.now();
    let r;
    try {
      r = await this.rails.status(payment.endToEndId);
    } catch (err) {
      await this.attempt(
        payment.id,
        'INQUIRY',
        'NO_RESPONSE',
        { error: String((err as Error).message) },
        started,
      );
      return payment; // still UNKNOWN; the sweeper asks again
    }
    await this.attempt(payment.id, 'INQUIRY', r.status, r, started);
    const fresh = await this.sm.get(payment.id);
    if (fresh.state !== 'UNKNOWN') return fresh; // settled concurrently
    if (r.status === 'ACSC') {
      return this.sm.transition(fresh, 'SUCCESS', {
        by,
        reason: 'INQUIRY_CONFIRMED_ACSC',
        ledger: 'PAYOUT',
        patch: { providerRef: r.providerRef, settledAt: new Date() },
      });
    }
    return this.sm.transition(fresh, 'FAILED', {
      by,
      reason:
        r.status === 'NOT_FOUND' ? 'INQUIRY_NOT_RECEIVED_SAFE_TO_RETRY' : 'INQUIRY_CONFIRMED_RJCT',
    });
  }

  /** Recovers after restarts: settles UNKNOWN payouts and sends APPROVED ones that waited on a circuit. */
  private async sweep() {
    const stale = new Date(Date.now() - 5_000);
    const [unknown, approved] = await Promise.all([
      this.prisma.payment.findMany({
        where: { state: 'UNKNOWN', updatedAt: { lt: stale } },
        take: 20,
      }),
      this.prisma.payment.findMany({
        where: { state: 'APPROVED', updatedAt: { lt: stale } },
        take: 20,
      }),
    ]).catch(() => [[], []] as Payment[][]);
    for (const p of unknown) await this.settleUnknown(p).catch(() => undefined);
    for (const p of approved) await this.send(p).catch(() => undefined);
  }

  private attempt(
    paymentId: string,
    kind: string,
    outcome: string,
    detail: object,
    started: number,
  ) {
    return this.prisma.paymentAttempt.create({
      data: { paymentId, kind, outcome, detail: detail as object, latencyMs: Date.now() - started },
    });
  }
}
