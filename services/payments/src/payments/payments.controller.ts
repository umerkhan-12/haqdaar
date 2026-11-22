import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, ZBody, ZQuery, type AuthUser } from '@haqdaar/nest-kit';
import { PaymentState } from '@haqdaar/shared';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { PayoutService } from './payout.service';

/** Optional corrected mobile account number, given by the claimant after a failed payout. */
const RetryBody = z.object({
  alias: z
    .string()
    .regex(/^03\d{9}$/, 'Mobile number must look like 03XXXXXXXXX')
    .optional(),
});

const ListQuery = z.object({
  state: PaymentState.optional(),
  caseId: z.string().uuid().optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
});
const MineQuery = z.object({ caseId: z.string().uuid().optional() });
const NoteBody = z.object({ note: z.string().max(300).optional() }).default({});
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
  @Roles('officer')
  @Post(':id/release')
  @HttpCode(200)
  release(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(NoteBody) b: z.infer<typeof NoteBody>,
  ) {
    return this.payouts.release(id, user, b.note);
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
