import {
  Controller,
  ForbiddenException,
  NotFoundException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, sealMessage, ZBody, ZQuery, type AuthUser } from '@haqdaar/nest-kit';
import { env } from '../env';
import { receiptText } from '../receipts/receipt';
import { PaymentState } from '@haqdaar/shared';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { PayoutService } from './payout.service';

/** Optional corrected mobile account number, given by the claimant after a failed payout. */
// A retry with no body at all is the plain "send again".
const RetryBody = z.preprocess(
  (v) => v ?? {},
  z.object({
    alias: z
      .string()
      .regex(/^03\d{9}$/, 'Mobile number must look like 03XXXXXXXXX')
      .optional(),
  }),
);

const ListQuery = z.object({
  state: PaymentState.optional(),
  caseId: z.string().uuid().optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
});
const MineQuery = z.object({ caseId: z.string().uuid().optional() });
const ReceiptQuery = z.object({ caseId: z.string().uuid() });
const NoteBody = z.object({ note: z.string().max(300).optional() }).default({});
/** Release a hold; with `alias`, to a corrected mobile account number from the claimant. */
const ReleaseBody = z
  .object({
    note: z.string().max(300).optional(),
    alias: z
      .string()
      .regex(/^03\d{9}$/, 'Mobile number must look like 03XXXXXXXXX')
      .optional(),
  })
  .default({});
const ReversalBody = z.object({ reason: z.string().min(5).max(300) });

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payouts: PayoutService,
  ) {}

  @Roles('officer', 'admin', 'auditor')
  @Get()
  list(@CurrentUser() user: AuthUser, @ZQuery(ListQuery) q: z.infer<typeof ListQuery>) {
    return this.prisma.payment.findMany({
      where: {
        tenantId: user.tenantId,
        ...(q.state ? { state: q.state } : {}),
        ...(q.caseId ? { caseId: q.caseId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.take,
      // The latest step and its reason: staff must see WHY a payout is held or failed, not only that it is.
      include: {
        transitions: {
          orderBy: { at: 'desc' },
          take: 1,
          select: { to: true, reason: true, at: true },
        },
      },
    });
  }

  /**
   * A citizen's own payouts (or the family a helper is acting for), newest first. The person comes from
   * the token, never from the request, so nobody can read another person's payments. Only what she needs
   * to hear: amount, state and dates; no account numbers, no officer ids.
   */
  /**
   * Her Haq Receipt for one paid claim, sealed: the same text and Haqdaar code as the SMS, so she
   * (or anyone she shows it to) can prove it is genuine in "Is this message real?".
   */
  @Roles('citizen', 'helper')
  @Get('mine/receipt')
  async myReceipt(
    @CurrentUser() user: AuthUser,
    @ZQuery(ReceiptQuery) q: z.infer<typeof ReceiptQuery>,
  ) {
    if (!user.onBehalfOf) throw new ForbiddenException('No person linked');
    const p = await this.prisma.payment.findFirst({
      where: {
        tenantId: user.tenantId,
        personId: user.onBehalfOf,
        caseId: q.caseId,
        state: 'SUCCESS',
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!p) throw new NotFoundException('No paid payout for this claim');
    const sealed = sealMessage(
      receiptText(p.amount, p.providerRef),
      env.SEAL_SECRET,
      new Date(Date.now() + 30 * 86_400_000),
    );
    return {
      amount: p.amount,
      ref: p.providerRef,
      paidAt: p.settledAt,
      sealed,
      code: sealed.split('\n').at(-1)!.replace('Haqdaar code: ', ''),
    };
  }

  @Roles('citizen', 'helper')
  @Get('mine')
  async mine(@CurrentUser() user: AuthUser, @ZQuery(MineQuery) q: z.infer<typeof MineQuery>) {
    if (!user.onBehalfOf) throw new ForbiddenException('No person linked');
    const rows = await this.prisma.payment.findMany({
      where: {
        tenantId: user.tenantId,
        personId: user.onBehalfOf,
        ...(q.caseId ? { caseId: q.caseId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        caseId: true,
        amount: true,
        currency: true,
        state: true,
        settledAt: true,
        createdAt: true,
      },
    });
    return rows;
  }

  @Roles('officer', 'admin', 'auditor')
  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.payment.findFirstOrThrow({
      where: { id, tenantId: user.tenantId },
      include: {
        transitions: { orderBy: { at: 'asc' } },
        attempts: { orderBy: { at: 'asc' } },
        ledger: { orderBy: { createdAt: 'asc' } },
        approvals: { orderBy: { at: 'asc' } },
      },
    });
  }

  /** HELD → AWAITING_APPROVAL. The releasing officer becomes the maker. */
  @Roles('officer', 'admin')
  @Post(':id/release')
  @HttpCode(200)
  release(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(ReleaseBody) b: z.infer<typeof ReleaseBody>,
  ) {
    return this.payouts.release(id, user, b.note, b.alias);
  }

  /** Checker approval; must be a different person from the maker. Sends the payout. */
  @Roles('officer', 'admin')
  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(NoteBody) b: z.infer<typeof NoteBody>,
  ) {
    return this.payouts.approve(id, user, b.note);
  }

  /** UNKNOWN → ask Raast what happened. Never resends. */
  @Roles('officer', 'admin')
  @Post(':id/inquiry')
  @HttpCode(200)
  inquiry(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.inquiry(id, user, user.tenantId);
  }

  @Roles('officer', 'admin')
  @Post(':id/retry')
  @HttpCode(200)
  retry(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(RetryBody) b: z.infer<typeof RetryBody>,
  ) {
    return this.payouts.retry(id, user, b.alias);
  }

  @Roles('officer', 'admin')
  @Post(':id/reversal')
  @HttpCode(200)
  reversal(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(ReversalBody) b: z.infer<typeof ReversalBody>,
  ) {
    return this.payouts.requestReversal(id, user, b.reason);
  }

  @Roles('officer', 'admin')
  @Post(':id/reversal/approve')
  @HttpCode(200)
  approveReversal(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.approveReversal(id, user);
  }
}
